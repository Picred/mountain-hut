// The warden can also perform the employee functions (see context.md).
export const isEmployee = (user) => user?.role === "employee" || user?.role === "warden";
