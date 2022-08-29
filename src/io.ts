import { createInterface } from 'readline';

export const sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

export const recordToDict = (
    record: Record<string, any> | { [name: string]: any }
) => {
    return Object.entries(record).reduce((current, [key, value]) => {
        current[key] = value;
        return current;
    }, {} as { [name: string]: any });
};

export const promptUser = (query: string) : Promise<string> => {
    const prompt = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => prompt.question(query, response => {
        prompt.close();
        resolve(response);
    }))
}
