import { Response } from "node-fetch";
import { v4 as uuid4 } from "uuid";
import { NodeFetchOptions } from "make-fetch-happen";
import { sleep } from "./io";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { gunzipSync, gzipSync } from "zlib";

interface ArchivedPayload {
  identifier: string;
  request: ArchivedRequest;
  response: ArchivedResponse;
  inflightMilliseconds: number;
}

interface ArchivedRequest {
  url: string;
  method: string | undefined;
  headers: { [key: string]: any } | undefined;
  body: string | null;

  // Order that the request was issued; expected to be FIFO
  // Allows requests with the same parameters to return in the correct order
  order: number;
}

interface ArchivedResponse {
  // https://fetch.spec.whatwg.org/#responseinit
  // URL might be different from the request URL in the case of a redirect
  url: string;

  /// response metadata
  redirected: boolean;
  status: number;
  statusText: string;
  headers: { [key: string]: any };
  body: string;
}

type ReplyMode = "read" | "write";

class ReplayError extends Error {}

export default class ReplayManager {
  // Current mode of the
  mode: ReplyMode;

  // Current replay path; intended to wrap a single page request.
  // This is a gzipped json file by convention to reduce file size.
  path: string | null;

  // Whether to simulate network requests that might take some time inflight; helps
  // to add reproducability for tests that might have race conditions or other failure
  // cases that are driven by time of inflight requests.
  simulateLatency: boolean;

  // List of currently archived requests
  requestTape: Array<ArchivedPayload>;

  // List of payloads that have already been played as part of this tape
  consumedPayloads: Set<string>;

  constructor(
    path: string | null,
    mode: ReplyMode = "read",
    simulateLatency: boolean = true
  ) {
    this.path = path;
    this.mode = mode;
    this.simulateLatency = simulateLatency;
    this.requestTape = [];
    this.consumedPayloads = new Set();

    if (this.mode == "read" && this.path) {
      console.log("Will load tape...");
      if (!existsSync(this.path)) {
          throw Error(`No file found at path: ${this.path}`)
      }
      this.requestTape = this.openTape();
      console.log(`Did load: ${this.requestTape.length}`);
    }
  }

  playTape() {
    /*
         Starts a new session to playback the responses
         */
    this.consumedPayloads = new Set();
  }

  async handleFetch(
    url: string,
    config: NodeFetchOptions,
    fetchFn: any
  ): Promise<Response> {
    if (this.mode == "read") {
      return await this.simulateResponse(url, config);
    } else if (this.mode == "write") {
      return await this.newRequest(url, config, fetchFn);
    } else {
      throw new ReplayError();
    }
  }

  async newRequest(
    url: string,
    config: NodeFetchOptions,
    fetchFn: any
  ): Promise<Response> {
    const startedAt = Date.now();

    const response = await fetchFn(url, config);

    // Mark where this request has finished as close to the actual fetch request
    // finishing as possible
    const finishedAt = Date.now();

    // We can only consume this once - a clone won't work here because of buffer
    // size constraints: https://github.com/node-fetch/node-fetch/issues/553
    const body = await response.buffer();
    response.buffer = async () => {
      return body;
    };

    this.requestTape.push({
      identifier: uuid4().toString(),
      request: {
        url,
        method: config.method,
        headers: config.headers,
        body: config.body ? (config.body as Buffer).toString("base64") : null,
        order: this.requestTape.length,
      },
      response: {
        url: response.url,
        status: response.status,
        headers: response.headers,
        body: (await response.buffer()).toString("base64"),
        redirected: response.redirected,
        statusText: response.statusText,
      },
      inflightMilliseconds: finishedAt - startedAt,
    });

    return response;
  }

  async simulateResponse(
    url: string,
    config: NodeFetchOptions
  ): Promise<Response> {
    /*
        Simulates a response from the server. Finds the closest matching
        file. We will break ties by this order of priority:
        - Base path (www.website.com/path)
        - Query path (ie. ? parameters)
        - Headers (maximum overlap)

        TODO: add the post body here as well.

        A base path match is required. Query and headers are optional.

        In case of race conditions we will also attempt to respond with the
        same `inflight` timing that was.
        - Time

        If no valid response is found, we'll throw an error.
    */
    console.log("Simulate", url);
    const {
      origin: requiredOrigin,
      pathname: requiredPathname,
      searchParams: optionalSearchParams,
    } = new URL(url);

    // Both search params and - we define the score to be the amount of overlapping
    // key/value pairs they have
    const scoreDictionaries = (
      truth: { [key: string]: any } | undefined,
      compare: { [key: string]: any } | undefined
    ) => {
      if (!truth || !compare) return 0;

      return Object.entries(truth)
        .map(([key, value]) => (value == compare[key] ? 1 : 0))
        .reduce((previous: number, value) => previous + value, 0);
    };

    const matchingRequests = this.requestTape
      .map((archive) => ({
        ...archive,
        parsedUrl: new URL(archive.request.url),
      }))
      .filter(
        // Hard filter for origin and pathname
        ({ parsedUrl, request }) =>
          parsedUrl.origin == requiredOrigin &&
          parsedUrl.pathname == requiredPathname &&
          (request.method || "GET") == (config.method || "GET")
      )
      .map(
        // Soft scoring for the other criteria
        (archive) => ({
          ...archive,
          queryScore: scoreDictionaries(
            archive.parsedUrl.searchParams,
            optionalSearchParams
          ),
          headerScore: scoreDictionaries(
            archive.request.headers,
            config.headers
          ),
        })
      )
      .sort(
        // Prioritize ones that have a higher query score, then header score if there's still
        // a tie between multiple
        (a, b) => {
          if (a.queryScore > b.queryScore) return -1;
          else if (a.queryScore < b.queryScore) return 1;

          if (a.headerScore > b.headerScore) return -1;
          else if (a.headerScore < b.headerScore) return 1;

          // Then, as a last priority (ie. all else matches), sort by order
          return a.request.order - b.request.order;
        }
      )
      .filter(
        // Each fetch should only be replayed once
        (archive) => !this.consumedPayloads.has(archive.identifier)
      );

    // No valid remaining requests
    if (matchingRequests.length == 0) {
      throw new ReplayError();
    }

    const match = matchingRequests[0];
    this.consumedPayloads.add(match.identifier);

    if (this.simulateLatency) await sleep(match.inflightMilliseconds);

    // Hydrate a new response object, mocking some of the values that the API
    // won't let us natively set
    const fullResponse = new Response(
      Buffer.from(match.response.body, "base64"),
      {
        status: match.response.status,
        headers: match.response.headers,
        statusText: match.response.statusText,
      }
    );
    Object.defineProperty(fullResponse, "url", { value: match.response.url });
    Object.defineProperty(fullResponse, "redirected", {
      value: match.response.redirected,
    });

    return fullResponse;
  }

  saveTape() {
    if (!this.path) throw Error();
    const savedTape = JSON.stringify(this.requestTape);

    const data = gzipSync(savedTape);
    writeFileSync(this.path, data);
  }

  openTape() {
    if (!this.path) throw Error();
    const read = readFileSync(this.path);
    const uncompressed = gunzipSync(read);
    return JSON.parse(uncompressed.toString());
  }
}
