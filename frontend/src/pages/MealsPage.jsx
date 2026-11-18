import { useEffect, useState } from "react";
import { Link } from "react-router";
import Calendar from "../components/Calendar";
import MenuMarkdown from "../components/MenuMarkdown";
import { getMealsByDate } from "../api/meal_api";

// Local YYYY-MM-DD string, as used by the calendar.
const dateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

/**
 * Public page: meal times and menus of the selected day.
 */
export const MealsPage = () => {
    const today = dateKey(new Date());
    const [date, setDate] = useState(today);
    // Answer of the last request, with the date it refers to.
    const [result, setResult] = useState({ date: null, meals: [], error: "" });
    const loading = result.date !== date;
    const { meals, error } = result;

    useEffect(() => {
        // Ignore the answer of an outdated request if the date changes.
        let cancelled = false;

        getMealsByDate(date)
            .then((data) => !cancelled && setResult({ date, meals: data, error: "" }))
            .catch((err) => !cancelled && setResult({ date, meals: [], error: err.message }));

        return () => {
            cancelled = true;
        };
    }, [date]);

    const formattedDate = new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });

    return (
        <div className="min-h-screen px-4 py-10 text-slate-100 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-6xl">
                <h1 className="text-3xl font-bold text-white sm:text-4xl">Meals and menus</h1>
                <p className="mt-3 text-sm text-slate-400">
                    Choose a day to see when meals are served and what is on the menu.
                </p>

                <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
                    <Calendar
                        selectedDate={date}
                        onDateSelect={(newDate) => {
                            if (newDate >= today) setDate(newDate);
                        }}
                        minDate={today}
                    />

                    <section
                        aria-label="Meals of the selected day"
                        className="rounded-2xl border border-white/10 bg-[#0e1622]/90 p-5 shadow-xl sm:p-6"
                    >
                        <h2 className="mb-4 text-sm text-slate-400">{formattedDate}</h2>

                        {loading ? (
                            <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-400">
                                <span className="loading loading-spinner loading-sm text-sky-300" />
                                Loading meals...
                            </div>
                        ) : error ? (
                            <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-300">
                                {error}
                            </p>
                        ) : meals.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-white/15 bg-[#090f19] p-5 text-center text-sm text-slate-400">
                                No meals are served on this day.
                            </p>
                        ) : (
                            <ul className="space-y-4">
                                {meals.map((meal) => (
                                    <li
                                        key={meal.slotId}
                                        className="rounded-xl border border-white/10 bg-[#090f19] p-4"
                                    >
                                        <h3 className="font-semibold text-sky-300">
                                            {meal.startTime} – {meal.endTime}
                                        </h3>
                                        <div className="mt-2 text-sm text-slate-200">
                                            {meal.menu ? (
                                                <MenuMarkdown menu={meal.menu} />
                                            ) : (
                                                <p className="text-slate-400">The menu has not been published yet.</p>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {!loading && meals.length > 0 && (
                            <Link
                                to="/reservations"
                                state={{ reservation: { date } }}
                                className="mt-6 block w-full rounded-xl bg-sky-300 px-5 py-3 text-center font-semibold text-slate-950 transition-colors hover:bg-sky-200"
                            >
                                Reserve a table
                            </Link>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
};
