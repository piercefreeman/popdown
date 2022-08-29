import { Page, chromium } from 'playwright';
import { promptUser } from './io';
import ReplayManager from './replay';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import chalk from 'chalk';
import { exit } from 'process';
import Proxy from 'http-mitm-proxy';

const TAPE_DIRECTORY = "./tape-directory";
const IDENTIFIER_KEY = "pd-identifier"

//process.env.NODE_EXTRA_CA_CERTS = "./ca_file"

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

const run = async () => {
    var proxy = Proxy();

proxy.onError(function(ctx: any, err: any) {
    console.error('proxy error:', err);
    if (err.code === 'ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN') {
        console.log("RUN AUTHORIZE")
        // This will add a `NodeMITMProxyCA` cert to your local desktop
        console.log("security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ./.http-mitm-proxy/certs/ca.pem")
        exit();
    }
  });
  
  // Indicates that a request has started
  proxy.onRequest(function(ctx: any, callback: any) {
    const request = ctx.clientToProxyRequest;

    console.log("ON REQUEST", request.url)

    if (request.url.indexOf("produce_batch") > -1) {
        ctx.proxyToClientResponse.write("Hacked, you cannot proceed to the website");
        ctx.proxyToClientResponse.end();
        // no callback() so proxy request is not sent to the server
        return;
    }

    if (request.url.indexOf("analytics.js") > -1) {
      ctx.use(Proxy.gunzip);
  
      /*
      proxy.onRequestData(function(ctx, chunk, callback) {
        console.log('REQUEST DATA:', chunk.toString());
        return callback(null, chunk);
      });*/
    
      ctx.onResponse(function(ctx: any, callback: any) {
        const response = ctx.proxyToServerRequest.res;
        console.log("ON RESPONSE", response.headers)
        return callback()
      });
    
      ctx.onResponseData(function(ctx: any, chunk: any, callback: any) {
        //chunk = new Buffer(chunk.toString().replace(/<h3.*?<\/h3>/g, '<h3>Pwned!</h3>'));
        chunk = Buffer.from("we are sparticus")
        return callback(null, chunk);
      });
    

      ctx.onResponseEnd(function(ctx: any, callback: any) {
        //chunk = new Buffer(chunk.toString().replace(/<h3.*?<\/h3>/g, '<h3>Pwned!</h3>'));
        return callback();
      });

      /*ctx.onResponseData(function(ctx: any, chunk: any, callback: any) {
        //chunk = new Buffer(chunk.toString().replace(/<h3.*?<\/h3>/g, '<h3>Pwned!</h3>'));
        chunk = new Buffer("we are sparticus")
        return callback(null, chunk);
      });*/
    }
    return callback();
  });
  
  proxy.listen({port: 5010});

    let url = await promptUser(chalk.blue("What's the url to add to the datapoint?\n > "));
    if (!url) {
        console.log(chalk.red("No website provided."));
        exit();
    }

    // Fix some of the common issues with the url
    if (url.indexOf("http") != 0) url = `http://${url}`;

    const tapeId = uuidv4();
    const replayManager = new ReplayManager(join(TAPE_DIRECTORY, `${tapeId}.json.gz`), "write");
    
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--auto-open-devtools-for-tabs'
        ],
        proxy: {
            server: 'http://127.0.0.1:5010'
        }
    });
    // Sometimes popups will only show the first time a page is loaded; we create a new
    // incognito browser to avoid this issue.
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    // Trust the root certificate
    // ?
    // security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ./ca_file
    // security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ./.http-mitm-proxy/certs/ca.pem

    /*page.on('request', request => {
        if (request.url().indexOf("produce_batch") > -1) {
            console.log(request.method(), request.postData())
            console.log(request)
        }
    });*/

    // await page.route("**/*", async (route: Route, request: Request) => {
    //     if (request.url().indexOf("produce_batch") > -1) {
    //         console.log("did receive", request.url());
    //     }
    //     route.continue();
    // });

  //page.on('response', response =>
      //console.log('<<', response.status(), response.url()));

      // Allow local proxy debugging to function appropriately
      /*const ca = readFileSync('/Users/piercefreeman/.proxyman/proxyman-ca.pem')
      console.log(ca);
      const httpsAgent = new https.Agent({
        rejectUnauthorized: true,
        ca,
      });*/
  
    // let pendingRequests = 0;
    // await page.route("**/*", async (route: Route, request: Request) => {
    //     const headers = recordToDict(
    //         await request.allHeaders()
    //     );
    //     if (headers["sec-ch-ua"]) {
    //         headers["sec-ch-ua"] = '"Chromium";v="104", " Not A;Brand";v="99", "Google Chrome";v="104"';
    //     }
    //     const bodyA = request.postData();

    //     if (request.url().indexOf("produce_batch") > -1) {
    //         console.log("BODY", bodyA)
    //         console.log("BODY2", request.postDataBuffer())
    //         console.log("BODY3", request.postDataJSON())
        
    //     }

    //     const fetchPayload = {
    //         method: request.method(),
    //         body: bodyA,
    //         headers,
    //         timeout: 15*1000,
    //         //agent: httpsAgent,
    //         proxy: "http://127.0.0.1:9090",
    //         strictSSL: false,
    //     } as any;
      
    //     console.log("Send request", request.url())
    //     if (request.url().indexOf("produce_batch") > -1) {
    //         console.log("PRODUCE BATCH", request)
    //         console.log("PRODUCE BATCH_PAYLOAD", fetchPayload)
    //     }

    //     pendingRequests += 1
    //     console.log("Pending", pendingRequests)
    //     const response = await replayManager.handleFetch(
    //         request.url(),
    //         fetchPayload,
    //         fetch
    //     );
    //     pendingRequests -=1
    //     console.log("Pending2", pendingRequests)

    //     if (request.url().indexOf("produce_batch") > -1) {
    //         console.log("PRODUCE BATCH RESPONSE", response)
    //     }
    
    //     const body = await response.buffer();

    //     return await route.fulfill({
    //         status: response.status,
    //         body: body,
    //         headers: recordToDict(response.headers.raw()),
    //     });
    // });

    try {
        await page.goto(url);
    } catch (e) {
        console.log(chalk.red(`Load error ${url}`));
    }

    const ans = await promptUser(chalk.blue("Do you see the popup? (y)\n > "));
    if (ans.charAt(0) != "y") {
        console.log(chalk.red("User confirmation failed."));
        exit();
    }

    await injectElementIdentifiers(page);
    const identifiers = await getIdentifiers(page);
    console.log("\nElement identifiers injected. Check in devtools for the identifiers that match the main popup dom.\n");

    // Save the page content now since users might manipulate it while checking for popups
    const content = await page.content();
    const contentPath = join(TAPE_DIRECTORY, `${tapeId}.html`);
    await writeFile(contentPath, content);

    // Save a screenshot of the page
    const screenshot = await page.screenshot();
    const screenshotPath = join(TAPE_DIRECTORY, `${tapeId}.png`);
    await writeFile(screenshotPath, screenshot);

    const allPopupIdentifiers = [];
    while (true) {
        const ans = await promptUser(chalk.blue("What are the popup identifiers? (newline to finish)\n > "));
        if (!ans) break;
        // Validate that this is a valid identifier
        if (identifiers.indexOf(ans) == -1) {
            console.log(chalk.red("Invalid identifier. Try again..."));
            continue;
        } else {
            console.log(chalk.green("Valid identifier, adding to groundtruth..."));
        }
        allPopupIdentifiers.push(ans);
    }

    if (allPopupIdentifiers.length == 0) {
        console.log(chalk.red("No popup identifiers supplied."));
        exit();
    }

    // Save the groundtruth
    const groundtruth = {
        identifiers: allPopupIdentifiers,
    }
    const groundtruthPath = join(TAPE_DIRECTORY, `${tapeId}.groundtruth.json`);
    await writeFile(groundtruthPath, JSON.stringify(groundtruth));

    replayManager.saveTape();
    await browser.close();
}

run();
