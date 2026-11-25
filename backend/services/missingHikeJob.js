import { getMissingHikes } from "../models/dao/hikeDAO.js";
import { checkIntervalMs } from "../utils/missingHikeRules.js";

let timeoutId = null;
let isRunning = false;

export const startMissingHikeJob = () => {
    if (isRunning) return;

    const intervalMs = checkIntervalMs();
    isRunning = true;

    const run = async () => {
        if (!isRunning) return;

        const now = new Date();
        await checkMissingHikes(now);

        if (isRunning) {
            timeoutId = setTimeout(run, intervalMs);
        }
    };

    timeoutId = setTimeout(run, intervalMs);
};

export const stopMissingHikeJob = () => {
    isRunning = false;
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
};

const checkMissingHikes = async (now) => {
    const missingHikes = await getMissingHikes();
    console.log(missingHikes);
};