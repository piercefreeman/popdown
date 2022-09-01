import { chromium } from 'playwright';
import { promptUser, sleep } from './io.js';
import ReplayManager from './replay.js';
import { join } from 'path';
import { readFileSync } from 'fs';
import chalk from 'chalk';
import { TAPE_DIRECTORY } from './constants.js';

const run = async () => {
    //const tapeId = await promptUser(chalk.blue("What's the tape ID?\n > "));
    const tapeId = "42497dee-c685-497e-8f80-46c2875ab4b1";

    const groundtruth = JSON.parse(readFileSync(join(TAPE_DIRECTORY, `${tapeId}.groundtruth.json`)).toString());
    const url = groundtruth.request;
    const responseUrl = groundtruth.response;

    // Swap out for the identifiers; we should have the styles & like injected within the page
    const pageContent = readFileSync(join(TAPE_DIRECTORY, `${tapeId}.html`)).toString();

    const replayManager = new ReplayManager(
        join(TAPE_DIRECTORY, `${tapeId}.json.gz`),
        {
            overrideUrls: new Map(
                [
                    [responseUrl, pageContent]
                ]
            )    
        }
    );
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
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    try {
        await page.goto(url);
    } catch (e) {
        console.log(chalk.red(`Load error ${url}`));
    }

    console.log("Should be ready")
}

run();
