import { Page } from 'playwright';
import { IDENTIFIER_KEY } from './constants';

export const getIdentifiers = async (page: Page): Promise<Array<string>> => {
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

export const injectElementIdentifiers = async (page: Page) => {
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
