import { useEffect, useState } from "react";
import hikeAPI from "../api/hike_api";

const formatDateTime = (value) =>
    new Date(value).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });

export const ActiveHikesPage = () => {
    const [hikes, setHikes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedHikeId, setExpandedHikeId] = useState(null);


    const loadHikes = async () => {
        setLoading(true);
        setError(null);

        try {
            const data = await hikeAPI.getActiveHikes();
            setHikes(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;

        hikeAPI.getActiveHikes()
            .then((data) => {
                if (!cancelled) {
                    setHikes(data);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err.message);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);


    const overdueCount = hikes.filter((hike) => hike.isOverdue).length;

    return (
        <section className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
            <header className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-300/25 bg-sky-300/10 text-sky-300">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
                            <path d="M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19" />
                        </svg>
                    </span>
                    <h1 className="text-3xl sm:text-4xl font-bold text-white">
                        Active Hikes
                    </h1>
                </div>
                <p className="text-slate-300">
                    Monitor hikers currently on a hike and their expected return times.
                </p>
            </header>

            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div className="flex flex-wrap gap-3">
                    <div className="rounded-xl border border-white/10 bg-[#0e1622]/90 px-5 py-3">
                        <p className="text-xs text-slate-400">Active hikes</p>
                        <p className="text-2xl font-bold text-white">{hikes.length}</p>
                    </div>

                    <div className="rounded-xl border-2 border-red-400 bg-[#172333] px-5 py-3 shadow-xl">
                        <p className="text-xs font-semibold text-red-300">Overdue hikes</p>
                        <p className="text-2xl font-bold text-red-300">
                            {overdueCount}
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={loadHikes}
                    disabled={loading}
                    className="btn bg-sky-300 hover:bg-sky-400 border-sky-300 hover:border-sky-400 text-slate-950 font-semibold disabled:opacity-40"
                >
                    {loading ? "Refreshing..." : "Refresh"}
                </button>
            </div>

            {error && (
                <div
                    role="alert"
                    className="mb-6 rounded-xl border-2 border-red-400 bg-[#172333] p-4 font-semibold text-red-300 shadow-xl"
                >
                    {error}
                </div>
            )}

            {loading ? (
                <p className="rounded-2xl border border-white/10 bg-[#0e1622]/85 p-6 text-slate-300">
                    Loading active hikes...
                </p>
            ) : error ? null : hikes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/15 bg-[#0e1622]/65 p-9 text-center">
                    <h2 className="text-lg font-semibold text-white">
                        No active hikes
                    </h2>
                    <p className="text-sm text-slate-400 mt-2">
                        There are currently no hikers registered as being on a hike.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {hikes.map((hike) => {
                        const expanded = expandedHikeId === hike.hikeId;

                        return (
                            <article
                                key={hike.hikeId}
                                className={`rounded-2xl border bg-[#0e1622]/90 p-5 sm:p-6 shadow-xl ${hike.isOverdue
                                    ? "border-red-400/40"
                                    : "border-white/10"
                                    }`}
                            >
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <h2 className="text-xl font-semibold text-white">
                                                {hike.hiker.name}
                                            </h2>

                                            {hike.isOverdue && (
                                                <span className="rounded-full border border-red-400/30 bg-red-400/10 px-3 py-1 text-xs font-semibold text-red-300">
                                                    Overdue
                                                </span>
                                            )}
                                        </div>

                                        <p className="mt-2 text-sm text-slate-300">
                                            {hike.destination}
                                        </p>

                                        <p className="mt-1 text-sm text-slate-400">
                                            {hike.partySize}{" "}
                                            {hike.partySize === 1 ? "hiker" : "hikers"}
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() =>
                                            setExpandedHikeId(expanded ? null : hike.hikeId)
                                        }
                                        aria-expanded={expanded}
                                        className="shrink-0 rounded-xl border border-sky-300/30 bg-sky-300/10 px-4 py-2.5 text-sm font-semibold text-sky-300 hover:bg-sky-300/20 transition-colors cursor-pointer"
                                    >
                                        {expanded ? "Hide details" : "View details"}
                                    </button>
                                </div>

                                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                                        <p className="text-xs text-slate-400 mb-1">
                                            Scheduled departure
                                        </p>
                                        <p className="font-semibold text-white">
                                            {formatDateTime(hike.scheduledDeparture)}
                                        </p>
                                    </div>

                                    <div
                                        className={`rounded-xl border p-4 ${hike.isOverdue
                                            ? "border-2 border-red-400 bg-[#172333]"
                                            : "border-white/10 bg-white/5"
                                            }`}
                                    >
                                        <p className="text-xs text-slate-400 mb-1">
                                            Expected return
                                        </p>
                                        <p
                                            className={`font-semibold ${hike.isOverdue ? "text-red-300" : "text-white"
                                                }`}
                                        >
                                            {formatDateTime(hike.expectedArrival)}
                                        </p>
                                    </div>
                                </div>

                                {expanded && (
                                    <div className="mt-5 border-t border-white/10 pt-5 space-y-5">
                                        <div>
                                            <h3 className="text-sm font-semibold text-white mb-2">
                                                Route
                                            </h3>
                                            <p className="text-sm text-slate-300 whitespace-pre-wrap">
                                                {hike.route}
                                            </p>
                                        </div>

                                        <div>
                                            <h3 className="text-sm font-semibold text-white mb-2">
                                                Intermediate passage points
                                            </h3>

                                            {hike.passages.length > 0 ? (
                                                <ul className="list-disc list-inside space-y-1 text-sm text-slate-300">
                                                    {hike.passages.map((passage, index) => (
                                                        <li key={index}>{passage}</li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-sm text-slate-400">
                                                    No intermediate passage points.
                                                </p>
                                            )}
                                        </div>

                                        <div>
                                            <h3 className="text-sm font-semibold text-white mb-3">
                                                Hiker information
                                            </h3>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                                <div>
                                                    <p className="text-slate-400">Name</p>
                                                    <p className="text-white mt-1">
                                                        {hike.hiker.name}
                                                    </p>
                                                </div>

                                                <div>
                                                    <p className="text-slate-400">Email</p>
                                                    <p className="text-white mt-1 break-all">
                                                        {hike.hiker.email}
                                                    </p>
                                                </div>

                                                <div>
                                                    <p className="text-slate-400">Phone</p>
                                                    <p className="text-white mt-1">
                                                        {hike.hiker.phone || "Not provided"}
                                                    </p>
                                                </div>

                                                <div>
                                                    <p className="text-slate-400">
                                                        Emergency contact
                                                    </p>
                                                    <p className="text-white mt-1">
                                                        {hike.hiker.emergencyContact || "Not provided"}
                                                    </p>
                                                </div>
                                            </div>

                                            {hike.hiker.notes && (
                                                <div className="mt-4">
                                                    <p className="text-sm text-slate-400">Notes</p>
                                                    <p className="text-sm text-white mt-1 whitespace-pre-wrap">
                                                        {hike.hiker.notes}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                        {hike.partySize > 1 && (
                                            <div>
                                                <h3 className="text-sm font-semibold text-white mb-3">
                                                    Party members
                                                </h3>

                                                {hike.members?.length > 0 ? (
                                                    <div className="space-y-3">
                                                        {hike.members.map((member, index) => (
                                                            <div
                                                                key={index}
                                                                className="rounded-xl border border-white/10 bg-white/5 p-4"
                                                            >
                                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                                                    <div>
                                                                        <p className="text-slate-400">Name</p>
                                                                        <p className="text-white mt-1">
                                                                            {member.name}
                                                                        </p>
                                                                    </div>

                                                                    <div>
                                                                        <p className="text-slate-400">Phone</p>
                                                                        <p className="text-white mt-1">
                                                                            {member.phone || "Not provided"}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-sm text-slate-400">
                                                        No party member details provided.
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
};
