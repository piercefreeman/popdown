import { Response } from "node-fetch";
import { v4 as uuid4 } from "uuid";
import { sleep } from "./io";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { gunzipSync, gzipSync, brotliCompressSync, inflateSync } from "zlib";
import Proxy, { IProxy } from '@bjowes/http-mitm-proxy';
import { join } from 'path';

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
  statusCode: number;
  statusMessage: string;
  headers: { [key: string]: any };
  body: string;
}

interface ReplayConfig {
  mode?: ReplyMode;
  simulateLatency?: boolean,
  port?: number;
  overrideUrls?: Map<string, string> | null;
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

  // Webservice proxy intended to be the middleman layer between Chrome and replay handler
  proxy: IProxy;
  port: number;

  // Custom overrides of URL -> page
  // Assumes that the URL is already in the tape store, won't execute otherwise
  overrideUrls: Map<string, string>;

  constructor(
    path: string | null,
    config: ReplayConfig | null = null,
  ) {
    config = config || {}

    this.path = path;
    this.mode = config.mode || "read";
    this.simulateLatency = config.simulateLatency || true;
    this.requestTape = [];
    this.consumedPayloads = new Set();

    this.proxy = this.setupProxy()
    this.port = config.port || 5010;
    this.overrideUrls = config.overrideUrls || new Map();

    if (this.mode == "read" && this.path) {
      console.log("Will load tape...");
      if (!existsSync(this.path)) {
          throw Error(`No file found at path: ${this.path}`)
      }
      this.requestTape = this.openTape();
      console.log(`Did load tape with size: ${this.requestTape.length}`);
    }
  }

  setupProxy() {
    const self = this as any;
    const proxy = Proxy();

    proxy.onError((ctx: any, err: any) => {
      const url = ctx && ctx.clientToProxyRequest ? ctx.clientToProxyRequest.url : "";
      console.error(`Proxy error on ${url}:`, err);
      if (err.code === "ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN") {
          console.log("SSL certification failed.\nIt's likely you haven't installed the root certificate on your machine.");

          // This will add a `NodeMITMProxyCA` cert to your local desktop keychain
          console.log("MacOS: security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ./.http-mitm-proxy/certs/ca.pem")
          process.exit();
      }
    });

    proxy.onRequest(async (ctx: any, callback: any) => {
      const request = ctx.clientToProxyRequest;
      const clientResponse = ctx.proxyToClientResponse;

      if (this.mode == "read") {
        const response = await self.simulateResponse(request, ctx, callback);
        clientResponse.writeHeader(response.status || 500, response.headers);
        clientResponse.write(response.body);
        clientResponse.end()
        // no callback() so proxy request is not sent to the actual server
        return;
      } else if (this.mode == "write") {
        await self.newRequest(request, ctx, callback);
      } else {
        throw new ReplayError();
      }
      return callback();
    });

    return proxy;
  }

  listen() {
    // https://github.com/joeferner/node-http-mitm-proxy/issues/165
    // https://github.com/joeferner/node-http-mitm-proxy/issues/177
    this.proxy.listen({port: this.port});
  }

  close() {
    this.proxy.close();
  }

  playTape() {
    /*
         Starts a new session to playback the responses
         */
    this.consumedPayloads = new Set();
  }

  async newRequest(
    request: any,
    ctx: any,
    callback: any,
  ) {
    const self = this as any;
    const startedAt = Date.now();
    let finishedAt = null as null | number;
  
    const responseDataBuffers = [] as Buffer[];

    ctx.use(Proxy.gunzip);
  
    /*
    proxy.onRequestData(function(ctx, chunk, callback) {
      console.log('REQUEST DATA:', chunk.toString());
      return callback(null, chunk);
    });*/
  
    ctx.onResponse(function(ctx: any, callback: any) {
      return callback()
    });
  
    ctx.onResponseData(function(ctx: any, chunk: any, callback: any) {
      const proxyRequest = ctx.proxyToServerRequest;
      const response = ctx.serverToProxyResponse;

      //chunk = new Buffer(chunk.toString().replace(/<h3.*?<\/h3>/g, '<h3>Pwned!</h3>'));
      //chunk = Buffer.from(chunk.toString())
      responseDataBuffers.push(chunk);
      return callback(null, chunk);
    });

    ctx.onResponseEnd(function(ctx: any, callback: any) {
      // Mark where this request has finished as close to the actual fetch request
      // finishing as possible
      finishedAt = Date.now();

      const request = ctx.clientToProxyRequest;

      const proxyRequest = ctx.proxyToServerRequest;
      const response = ctx.serverToProxyResponse;

      /*if (`${proxyRequest.protocol}//${join(request.headers.host, request.url)}` == "https://www.aviatornation.com/collections/new-arrivals/products/5-stripe-hoodie-ocean-2") {
        const content = Buffer.concat(responseDataBuffers).toString();
        console.log("Content", content)
      }*/
  
      self.requestTape.push({
        identifier: uuid4().toString(),
        request: {
          // Since the proxy request actually connects to the 3rd party server, the protocol
          // communicates what the client wants to retrieve. The direct client request doesn't have
          // a protocol record since our server is on localhost
          url: `${proxyRequest.protocol}//${join(request.headers.host, request.url)}`,
          method: request.method,
          headers: request.headers,
          body: request.body ? (request.body as Buffer).toString("base64") : null,
          order: self.requestTape.length,
        },
        response: {
          // In the case of redirects, the proxy request is changed so the request URL should
          // mirror what the server responds with
          url: `${proxyRequest.protocol}//${join(proxyRequest.host, request.url)}`,
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(responseDataBuffers).toString("base64"),
          redirected: response.redirected,
          statusMessage: response.statusMessage,
        },
        inflightMilliseconds: finishedAt - startedAt,
      });

      //if (request.headers.host == "freeman.vc") {
      //  throw new Error();
      //}

      return callback();
    });
  }

  async simulateResponse(
    request: any,
    ctx: any,
    callback: any,
  ) {
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

        If no valid response is found, we'll respond with a 404 page. This is useful for
        cases where javascript generates some new outbound ping (ie. via a timestamp) but we don't
        actually want to make the outbound call.
    */

     // This appears to be the only object that has the protocol at this stage
     // of the request lifecycle
     const proxyAgent = ctx.proxyToServerRequestOptions.agent;
    let url = join(request.headers.host, request.url);
    url = `${proxyAgent.protocol}//${url}`;

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
          (request.method || "GET") == (request.method || "GET")
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
            request.headers
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
      console.log("Missing request:", url);
      return {
        body: Buffer.from("Content not found"),
        status: 404,
        headers: {},
      }
    }

    const match = matchingRequests[0];
    this.consumedPayloads.add(match.identifier);

    if (this.simulateLatency) await sleep(match.inflightMilliseconds);

    let body = Buffer.from(match.response.body, "base64");

    if (this.overrideUrls.get(match.response.url)) {
      console.log("Override used:", match.response.url)

      //body = gzipSync(Buffer.from(this.overrideUrls.get(match.response.url)!));
      let rawBody = this.overrideUrls.get(match.response.url)!;

      // Support different browser encoding schemas since the content should be encoded
      // at this stage already
      const encodingDefinitions = Object.entries(match.response.headers).filter(([key, value]) => (key.toLocaleLowerCase() == "content-encoding"));
      const encoding = encodingDefinitions.length > 0 ? encodingDefinitions[0][1] : null;

      // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Encoding
      if (encoding == "gzip") {
        body = gzipSync(rawBody);
      } else if (encoding == "br") {
        body = brotliCompressSync(rawBody);
      } else if (encoding == "deflate") {
        body = inflateSync(rawBody);
      } else if (!encoding) {
        // No encoding needed if null
        body = Buffer.from(body);
      } else {
        throw new Error(`Unknown encoding: ${encoding}`);
      }
    }

    // Hydrate a new response object, mocking some of the values that the API
    // won't let us natively set
    return {
      body,
      status: match.response.statusCode,
      headers: match.response.headers,
    };
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
