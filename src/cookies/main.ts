import { rules } from './rules.js'

export interface CrawlEntry {
    url: string,
    cssSelectors: string[],
}

export default () => {
    /*
     * Parse the rules
     */
    // Filter for .com (likely to be in english)
    let crawlList = Object.entries(rules).filter(([key, value]) => key.indexOf('.com') > -1);

    // Filter for items with "s" indexed
    crawlList = crawlList.filter(([key, value]) => (value as any)["s"] != undefined);

    // Ignore css inside brackets, with regex {.*} - leaving just the dom accessor for the root
    crawlList = crawlList.map(([key, value]) => [key, (value as any)["s"].replace(/{.*}/g, '')]);

    // Break apart multiple items and format into our interface
    return crawlList.map(
        ([key, value]) => ({
            url: key,
            cssSelectors: (value as any).split(',')
        })
    // Fix typing
    ) as CrawlEntry[];
}
