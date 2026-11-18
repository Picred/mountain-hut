import dayjs from "dayjs";


export const isString = value => typeof value === 'string';

export const isValidDate = date => dayjs(date, 'YYYY-MM-DD', true).isValid();

export const isId = value => Number.isInteger(value) && value > 0;

export const parseId = value => (/^\d+$/.test(value) ? Number(value) : NaN);

