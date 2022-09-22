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
