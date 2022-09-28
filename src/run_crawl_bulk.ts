import { chromium } from 'playwright';
import { promptUser } from './io';
import ReplayManager from './replay';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { writeFile } from 'fs/promises';
import chalk from 'chalk';
import { exit } from 'process';
import { TAPE_DIRECTORY, IDENTIFIER_KEY } from './constants';
import { getIdentifiers, injectElementIdentifiers } from './crawl_utilities';
import loadCookies, { CrawlEntry } from './cookies/main';

const getCrawledDomains = () => {
    /*
     * Get a list of domains that have already been crawled
     */
    //metadata["request"]
}


const limitConcurrency = async (promises: any[], limit: number) => {
    /*
     * Limit the number of concurrent promises
     *
     * @param promises: List of promises to limit
     * @param limit: Maximum number of concurrent promises
     */
    let i = 0;
    const results = {} as any; // TODO typing

    const worker = async () => {
        while (true) {
            console.log("start loop")
            // Pop off the current element and increment i
            const currentElement = i;
            i += 1;

            if (currentElement >= promises.length) {
                return;
            }

            const nextPromise = promises[currentElement];
            const result = await nextPromise();

            results[currentElement] = result;
            console.log("end loop")
        }
    }

    const workers = [];
    for (let j = 0; j < limit; j++) {
        console.log("will push worker")
        workers.push(worker());
    }

    await Promise.all(workers);

    return Object.entries(results).sort((a: any, b: any) => a[0] - b[0]).map((x) => x[1]);
}


const runCrawl = async (payload: CrawlEntry) => {
    // TODO: No-op if we have already crawled this page

    let { url, cssSelectors } = payload;

    if (url.indexOf("http") == -1) {
        url = `http://${url}`
    }

    const tapeId = uuidv4();
    const replayManager = new ReplayManager(join(TAPE_DIRECTORY, `${tapeId}.json.gz`), {mode: "write"});
    await replayManager.listen();

    const browser = await chromium.launch({
        headless: false,
        args: [
            '--auto-open-devtools-for-tabs'
        ],
        proxy: {
            server: `http://127.0.0.1:${replayManager.port}`,
        }
    });
    // Sometimes popups will only show the first time a page is loaded; we create a new
    // incognito browser to avoid this issue.
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await page.goto(url, {timeout: 1000*60, waitUntil: "networkidle"});
    } catch (e) {
        console.log(chalk.red(`Load error ${url}`));
    }

    // Wait for one of the given selectors to appear. The comma here represents that
    // we are looking for any element on the page
    console.log("Waiting for page selectors...", cssSelectors.join(", "))
    let willBreak = false;
    try {
        await page.waitForSelector(
            cssSelectors.join(", "),
            {
                timeout: 1000*10,
            }
        )
    } catch (e) {
        willBreak = true;
    }
    if (willBreak) {
        console.log("Couldn't find selector, move on.")
        await browser.close()
        replayManager.close();
        return;
    }

    await injectElementIdentifiers(page);
    const identifiers = await getIdentifiers(page);
    console.log("\nElement identifiers injected. Trying to find popup automatically.\n");

    const allPopupIdentifiers = [] as string[];

    // Try to find matches to the selectors
    for (const cssSelector of cssSelectors) {
        const foundElement = page.locator(cssSelector);
        const identifier = await foundElement.getAttribute(IDENTIFIER_KEY);
        if (identifier) {
            allPopupIdentifiers.push(identifier)    
        }
    }

    if (allPopupIdentifiers.length == 0) {
        console.log(chalk.red("No popup identifiers found."));
        await browser.close()
        replayManager.close();
        return;
    }

    // Save the page content now since we know there are matching elements for ground truth
    const content = await page.content();
    const contentPath = join(TAPE_DIRECTORY, `${tapeId}.html`);
    await writeFile(contentPath, content);

    // Save a screenshot of the page
    const screenshot = await page.screenshot();
    const screenshotPath = join(TAPE_DIRECTORY, `${tapeId}.png`);
    await writeFile(screenshotPath, screenshot);

    // Save the groundtruth
    const groundtruth = {
        request: url,
        respone: page.url(),
        identifiers: allPopupIdentifiers,
    }
    const groundtruthPath = join(TAPE_DIRECTORY, `${tapeId}.groundtruth.json`);
    await writeFile(groundtruthPath, JSON.stringify(groundtruth));

    replayManager.saveTape();
    await browser.close();

    replayManager.close();
}

const execAsync = async () => {
    const rulePayloads = loadCookies();
    console.log("payload", rulePayloads.length, rulePayloads[28])
    //runCrawl(rulePayloads[25])

    await limitConcurrency(
        [
            () => runCrawl(rulePayloads[25]),
            () => runCrawl(rulePayloads[26]),
            () => runCrawl(rulePayloads[35]),
        ],
        2,
    )
}

execAsync()
