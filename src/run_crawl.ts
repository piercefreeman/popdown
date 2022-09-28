import { Page, chromium } from 'playwright';
import { promptUser } from './io';
import ReplayManager from './replay';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, rm } from 'fs/promises';
import chalk from 'chalk';
import { exit } from 'process';
import { TAPE_DIRECTORY, IDENTIFIER_KEY } from './constants';
import { getIdentifiers, injectElementIdentifiers } from './crawl_utilities';

if (!existsSync(TAPE_DIRECTORY)) {
    mkdirSync(TAPE_DIRECTORY);
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

    const contentPath = join(TAPE_DIRECTORY, `${tapeId}.html`);
    const screenshotPath = join(TAPE_DIRECTORY, `${tapeId}.png`);
    const groundtruthPath = join(TAPE_DIRECTORY, `${tapeId}.groundtruth.json`);

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
        await page.goto(url, {timeout: 1000*60, waitUntil: "networkidle"});
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
    await writeFile(contentPath, content);

    // Save a screenshot of the page
    const screenshot = await page.screenshot();
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

        // Cleanup the artifact files since we won't be saving ground truth identifiers alongside them
        await rm(contentPath);
        await rm(screenshotPath);

        exit();
    }

    // Save the groundtruth
    const groundtruth = {
        request: url,
        respone: page.url(),
        identifiers: allPopupIdentifiers,
    }
    await writeFile(groundtruthPath, JSON.stringify(groundtruth));

    replayManager.saveTape();
    await browser.close();

    replayManager.close();

    // BUG: The CLI doesn't quit even once we cleanup resources; there's likely some
    // spawned thread or port hook that isn't cleaned up.
    exit();
}

run();
