import { useEffect, useState } from "react";
import hikeAPI from "../api/hike_api";

const formatDateTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";

    return date.toLocaleString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
};

const statusClass = {
    scheduled: "border-sky-400/30 bg-sky-400/10 text-sky-300",
    returned: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    cancelled: "border-red-400/30 bg-red-400/10 text-red-300",
};

export const MyHikesPage = () => {
    const [hikes, setHikes] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [notice, setNotice] = useState("");
    const [confirmingHikeId, setConfirmingHikeId] = useState(null);
    const [confirmError, setConfirmError] = useState("");

    useEffect(() => {
        let cancelled = false;

        hikeAPI.getHikerHikes()
            .then((data) => {
                if (!Array.isArray(data)) {
                    throw new Error("The hikes response was not in the expected format.");
                }
                if (!cancelled) setHikes(data);
            })
            .catch((error) => {
                if (!cancelled) setLoadError(error.message);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const confirmSafeArrival = async (hikeId) => {
        if (confirmingHikeId !== null) return;

        setConfirmingHikeId(hikeId);
        setConfirmError("");
        setNotice("");

        try {
            await hikeAPI.confirmHikeArrival(hikeId);
            setHikes((current) =>
                current.map((hike) =>
                    hike.hikeId === hikeId
                        ? { ...hike, status: "returned" }
                        : hike
                )
            );
            setNotice(`Hike #${hikeId} has been marked as safely returned.`);
        } catch (error) {
            setConfirmError(error.message);
        } finally {
            setConfirmingHikeId(null);
        }
    };

    return (
        <section className="w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-white sm:text-4xl">My hikes</h1>
                <p className="mt-3 text-sm text-slate-400">
                    View your registered hikes and confirm when you have arrived safely.
                </p>
            </div>

            {notice && (
                <div role="status" className="mb-6 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">
                    {notice}
                </div>
            )}

            {confirmError && (
                <div role="alert" className="mb-6 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
                    {confirmError}
                </div>
            )}

            {isLoading ? (
                <p role="status" className="rounded-2xl border border-white/10 bg-[#0e1622]/90 p-6 text-slate-300">
                    Loading your hikes...
                </p>
            ) : loadError ? (
                <div role="alert" className="rounded-2xl border border-red-400/30 bg-red-400/10 p-6 text-red-300">
                    {loadError}
                </div>
            ) : hikes.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-[#0e1622]/90 p-8 text-center">
                    <h2 className="text-xl font-semibold text-white">No hikes yet</h2>
                    <p className="mt-2 text-slate-300">
                        Your registered hikes will appear here.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {hikes.map((hike) => {
                        const canConfirm = hike.status === "scheduled";

                        return (
                            <article
                                key={hike.hikeId}
                                className="rounded-2xl border border-white/10 bg-[#0e1622]/95 p-5 shadow-lg sm:p-6"
                            >
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <h2 className="text-lg font-semibold text-white">
                                                Hike #{hike.hikeId}
                                            </h2>
                                            <span className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${statusClass[hike.status] ?? statusClass.cancelled}`}>
                                                {hike.status}
                                            </span>
                                        </div>
                                        <p className="mt-3 text-slate-200">{hike.destination}</p>
                                        <p className="mt-1 text-sm text-slate-400">{hike.route}</p>
                                    </div>

                                    {canConfirm && (
                                        <button
                                            type="button"
                                            onClick={() => confirmSafeArrival(hike.hikeId)}
                                            disabled={confirmingHikeId === hike.hikeId}
                                            className="btn btn-sm shrink-0 border-emerald-400 bg-emerald-400 text-slate-950 hover:border-emerald-300 hover:bg-emerald-300 disabled:opacity-60"
                                        >
                                            {confirmingHikeId === hike.hikeId
                                                ? "Confirming..."
                                                : "Confirm safe arrival"}
                                        </button>
                                    )}
                                </div>

                                <div className="mt-5 grid gap-3 border-t border-white/10 pt-4 text-sm sm:grid-cols-2">
                                    <div>
                                        <span className="block text-slate-400">Departure</span>
                                        <strong className="mt-1 block text-slate-200">
                                            {formatDateTime(hike.scheduledDeparture)}
                                        </strong>
                                    </div>
                                    <div>
                                        <span className="block text-slate-400">Expected arrival</span>
                                        <strong className="mt-1 block text-slate-200">
                                            {formatDateTime(hike.expectedArrival)}
                                        </strong>
                                    </div>
                                    <div>
                                        <span className="block text-slate-400">Party size</span>
                                        <strong className="mt-1 block text-slate-200">
                                            {hike.partySize} {hike.partySize === 1 ? "hiker" : "hikers"}
                                        </strong>
                                    </div>
                                </div>

                                {hike.passages?.length > 0 && (
                                    <div className="mt-4 border-t border-white/10 pt-4">
                                        <h3 className="text-sm font-semibold text-slate-300">Passages</h3>
                                        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-400">
                                            {hike.passages.map((passage, index) => (
                                                <li key={`${passage}-${index}`}>{passage}</li>
                                            ))}
                                        </ul>
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
