import { Route, Request, Page, chromium } from 'playwright';
import { recordToDict, promptUser } from './io';
import ReplayManager from './replay';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import fetch from 'make-fetch-happen';
import { writeFile } from 'fs/promises';

const TAPE_DIRECTORY = "./tape-directory";
const IDENTIFIER_KEY = "pd-identifier"

if (!existsSync(TAPE_DIRECTORY)) {
    mkdirSync(TAPE_DIRECTORY);
}

const injectElementIdentifiers = async (page: Page) => {
    await page.evaluate((identifierKey) => {
      // Re-implement uuid4 function so it can be injected into the page
      function uuidv4() {
        // @ts-ignore
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
          (
            c ^
            (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
          ).toString(16)
        );
      }

      var all = document.getElementsByTagName("*");
      Array.from(all).forEach((element) => {
        element.setAttribute(identifierKey, uuidv4().toString());
      });
    }, IDENTIFIER_KEY);
  }

  const getIdentifiers = async (page: Page): Promise<Array<string>> => {
    return await page.evaluate((identifierKey) => {
      const allElements = Array.from(
        document.querySelectorAll("*")
      ) as Array<HTMLElement>;

      return allElements
        .filter((element) => element.hasAttribute(identifierKey))
        .map((element) =>
          element.getAttribute(identifierKey)
        ) as Array<string>;
    }, IDENTIFIER_KEY);
  }

const run = async (url: string) => {
    const tapeId = uuidv4();
    const replayManager = new ReplayManager(join(TAPE_DIRECTORY, `${tapeId}.json.gz`), "write");
    
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--auto-open-devtools-for-tabs'
        ]
    });
    
    const page = await browser.newPage();

    await page.route("**/*", async (route: Route, request: Request) => {
        const headers = recordToDict(
            await request.allHeaders()
        );
    
        const fetchPayload = {
            method: request.method(),
            body: request.postData(),
            headers,
            timeout: 15*1000,
        } as any;
      
        const response = await replayManager.handleFetch(
            request.url(),
            fetchPayload,
            fetch
        );
    
        const body = await response.buffer();

        return await route.fulfill({
            status: response.status,
            body: body,
            headers: recordToDict(response.headers.raw()),
        });
    });

    await page.goto(url);

    const ans = await promptUser("Do you see the popup? (y)\n > ");
    if (ans.charAt(0) != "y") throw new Error("User confirmation failed.");

    await injectElementIdentifiers(page);
    const identifiers = await getIdentifiers(page);
    console.log("Element identifiers injected.");

    const allPopupIdentifiers = [];
    while (true) {
        const ans = await promptUser("What are the popup identifiers? (newline to finish)\n > ");
        if (!ans) break;
        // Validate that this is a valid identifier
        if (identifiers.indexOf(ans) == -1) {
            console.log("Invalid identifier. Try again...");
            continue;
        } else {
            console.log("Valid identifier, adding to groundtruth");
        }
        allPopupIdentifiers.push(ans);
    }

    if (allPopupIdentifiers.length == 0) throw new Error("No popup identifiers supplied.");

    // Save the page content
    const content = await page.content();
    const contentPath = join(TAPE_DIRECTORY, `${tapeId}.html`);
    await writeFile(contentPath, content);

    // Save a screenshot of the page
    const screenshot = await page.screenshot();
    const screenshotPath = join(TAPE_DIRECTORY, `${tapeId}.png`);
    await writeFile(screenshotPath, screenshot);

    // Save the groundtruth
    const groundtruth = {
        identifiers: allPopupIdentifiers,
    }
    const groundtruthPath = join(TAPE_DIRECTORY, `${tapeId}.groundtruth.json`);
    await writeFile(groundtruthPath, JSON.stringify(groundtruth));

    replayManager.saveTape();
    await browser.close();
}

const url = "https://freeman.vc";
run(url);
