import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";

dayjs.extend(customParseFormat);

export const isString = value => typeof value === 'string';

export const isNonEmptyString = value => isString(value) && value.trim().length > 0;

export const isValidDate = date => isString(date) && dayjs(date, 'YYYY-MM-DD', true).isValid();

export const isId = value => Number.isInteger(value) && value > 0;

export const parseId = value => (/^\d+$/.test(value) ? Number(value) : NaN);

export const isPositiveInt = value => Number.isInteger(value) && value > 0;

const ISO_DATE_TIME_REGEX =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const isValidIsoDateTime = value => {
    if (!isString(value) || !ISO_DATE_TIME_REGEX.test(value)) {
        return false;
    }

    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    const calDate = new Date(0);
    calDate.setUTCFullYear(year, month - 1, day);

    if (
        calDate.getUTCFullYear() !== year ||
        calDate.getUTCMonth() !== month - 1 ||
        calDate.getUTCDate() !== day
    ) {
        return false;
    }

    const match = value.match(/T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
    if (!match) return false;

    const [, hours, minutes, seconds, timezone] = match;
    if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) {
        return false;
    }

    if (timezone !== 'Z') {
        const offsetHours = Number(timezone.slice(1, 3));
        const offsetMinutes = Number(timezone.slice(4, 6));
        if (
            offsetHours > 14 ||
            offsetMinutes > 59 ||
            (offsetHours === 14 && offsetMinutes !== 0)
        ) {
            return false;
        }
    }

    return Number.isFinite(Date.parse(value));
};