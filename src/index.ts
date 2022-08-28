import { Route, Request, chromium } from 'playwright';
import { recordToDict } from './io';
import ReplayManager from './replay';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import fetch from 'make-fetch-happen';
import readline from 'readline';

const tapeDirectory = "./tape-directory";

if (!existsSync(tapeDirectory)) {
    mkdirSync(tapeDirectory);
}

function promptUser(query: string) {
    const prompt = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => prompt.question(query, response => {
        prompt.close();
        resolve(response);
    }))
}

const run = async (url: string) => {
    const tapeId = uuidv4();
    const replayManager = new ReplayManager(join(tapeDirectory, `${tapeId}.json.gz`), "write");
    
    const browser = await chromium.launch({
        headless: false,
    });
    
    const page = await browser.newPage();
    await page.goto(url);
    
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

    const ans = await promptUser("Do you see the popup (yes)? ");
    if (ans != "yes") throw new Error("User confirmation failed.");

    replayManager.saveTape();
    await browser.close();
}

const url = "https://freeman.vc";
run(url);
