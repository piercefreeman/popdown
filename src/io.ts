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
  