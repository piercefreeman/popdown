import { chromium } from 'playwright';
import ReplayManager from './replay';
import { join } from 'path';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import chalk from 'chalk';
import { TAPE_DIRECTORY, IDENTIFIER_KEY, FEATURES_DIRECTORY } from './constants';
import { getIdentifiers } from './crawl_utilities';
import { existsSync, mkdirSync } from 'fs';
import { gzipSync } from 'zlib';

if (!existsSync(FEATURES_DIRECTORY)) {
    mkdirSync(FEATURES_DIRECTORY);
}

const run = async () => {
    /*
     * Will featurize each recorded page in sequence. We recreate the browser instance
     * with the same dependencies so should create the exact environment that we observed
     * at crawl time while allowing us to separately iterate on the featurization format.
     * 
     * We export files as gzip compressed JSON files. The style featurization particularly
     * is highly redundant, since it encodes all CSS values that a browser supports and not
     * just the ones that were overriden by that element. This allows us to decrease file sizes
     * from 200MB+ to 5MB per page on average.
     */
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

        const encodedContent = rawFeatures.map((obj: any) => JSON.stringify(obj)).join("\n");
        writeFileSync(join(FEATURES_DIRECTORY, `${tapeId}.jsonl.gz`), gzipSync(encodedContent));
        console.log(chalk.green(`Wrote features for ${tapeId}`));

        replayManager.close();
        await browser.close();
    }
}

run();
