/** Promise-based sleep; injected everywhere a wait happens so tests never actually wait. */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type Sleep = typeof sleep;
