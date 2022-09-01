import { Page, chromium } from 'playwright';
import { promptUser } from './io';
import ReplayManager from './replay';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import chalk from 'chalk';
import { exit } from 'process';
import { TAPE_DIRECTORY, IDENTIFIER_KEY } from './constants';
import { getIdentifiers } from './crawl_utilities';

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

const run = async () => {
    let url = await promptUser(chalk.blue("What's the url to add to the datapoint?\n > "));
    if (!url) {
        console.log(chalk.red("No website provided."));
        exit();
    }

    // Fix some of the common issues with the url
    if (url.indexOf("http") != 0) url = `http://${url}`;

    const tapeId = uuidv4();
    const replayManager = new ReplayManager(join(TAPE_DIRECTORY, `${tapeId}.json.gz`), {mode: "write"});
    replayManager.listen();

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
    const context = await browser.newContext({
        //ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

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

    const allPopupIdentifiers = [] as string[];
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

run();
