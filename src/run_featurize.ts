import { chromium } from 'playwright';
import ReplayManager from './replay';
import { join } from 'path';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import chalk from 'chalk';
import { TAPE_DIRECTORY, IDENTIFIER_KEY, FEATURES_DIRECTORY } from './constants';
import { getIdentifiers } from './crawl_utilities';
import { existsSync, mkdirSync } from 'fs';

if (!existsSync(FEATURES_DIRECTORY)) {
    mkdirSync(FEATURES_DIRECTORY);
}

const run = async () => {
    const matchFiles = new RegExp(`(.+)\.groundtruth\.json`);
    const tapePath = (
        readdirSync(TAPE_DIRECTORY)
        .map((path) => {
            const components = path.match(matchFiles);
            return components ? components[1] : null;
        }).filter((path) => path !== null));

    for (const tapeId of tapePath) {
        console.log(chalk.yellow(`Processing tape: ${tapeId}`))

        const groundtruth = JSON.parse(readFileSync(join(TAPE_DIRECTORY, `${tapeId}.groundtruth.json`)).toString());
        const url = groundtruth.request;
        const responseUrl = groundtruth.response;

        // Swap out the raw html for the version with identifiers; we should have the styles
        // & like injected within the page
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
            await page.goto(url, {timeout: 1000*60, waitUntil: "networkidle"});
        } catch (e) {
            console.log(chalk.red(`Load error ${url}`));
        }

        console.log(chalk.green("Page should be ready. Featurizing elements (this might take awhile)..."))

        // We can now featurize the page contents - they should be 1:1 of what we saw
        // during the crawl
        // Get the styles for each element
        const identifiers = await getIdentifiers(page);

        const rawFeatures = await Promise.all(
            identifiers.map(async (identifier: string) => {

                const elementStyle = await page.evaluate(({identifier, IDENTIFIER_KEY}) => {
                    const element = document.querySelector(`[${IDENTIFIER_KEY}='${identifier}']`) as any;
                    return {...window.getComputedStyle(element)};
                }, {identifier, IDENTIFIER_KEY});

                return {
                    identifier,
                    style: elementStyle,
                }
            })
        );

        writeFileSync(join(FEATURES_DIRECTORY, `${tapeId}.json`), JSON.stringify(rawFeatures));
        console.log(chalk.green(`Wrote features for ${tapeId}`));

        replayManager.close();
        await browser.close();
    }
}

run();
