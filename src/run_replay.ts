import { chromium } from 'playwright';
import { promptUser, sleep } from './io';
import ReplayManager from './replay';
import { join } from 'path';
import { readFileSync } from 'fs';
import chalk from 'chalk';
import { TAPE_DIRECTORY } from './constants';

const run = async () => {
    const tapeId = await promptUser(chalk.blue("What's the tape ID?\n > "));

    const groundtruth = JSON.parse(readFileSync(join(TAPE_DIRECTORY, `${tapeId}.groundtruth.json`)).toString());
    const url = groundtruth.request;

    const replayManager = new ReplayManager(join(TAPE_DIRECTORY, `${tapeId}.json.gz`));
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

    // Keep alive until manually quit
    await sleep(60*60*1000)
}

run();
