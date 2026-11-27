import { useEffect, useState } from "react"
import hikeAPI from "../api/hike_api";

const POLL_MS = 30_000;
const SEEN_KEY = "seenHikeAlerts";
const keyOf = (h) => `${h.hikeId}-${h.alertNumber}`;

export const Alert = () => {
    const [newAlerts, setNewAlerts] = useState([]);

    useEffect(() => {
        const check = async () => {
            try {
                const res = await hikeAPI.getOverdueHikes()
                const seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
                setNewAlerts(res.filter((h) => !seen.has(keyOf(h))));
            } catch {
                // server non raggiungibile: si riprova al prossimo polling
            }
        };
        void check(); // check handles its own errors
        const id = setInterval(check, POLL_MS);
        return () => clearInterval(id);
    }, []);

    const dismiss = () => {
        const seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
        newAlerts.forEach((h) => seen.add(keyOf(h)));
        localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
        setNewAlerts([]);
    };

    if (newAlerts.length === 0) return null;

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                <div
                    role="alertdialog"
                    aria-labelledby="missing-hikers-title"
                    className="w-full max-w-md overflow-hidden rounded-xl border border-red-500/60 bg-slate-900 text-white shadow-2xl shadow-red-900/40"
                >
                    {/* Intestazione rossa */}
                    <div className="flex items-center gap-3 bg-red-600 px-5 py-4">
                        <span className="relative flex h-3 w-3">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                            <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
                        </span>
                        <h2 id="missing-hikers-title" className="text-lg font-bold tracking-wide">
                            Missing hiker{newAlerts.length > 1 ? "s" : ""}
                        </h2>
                    </div>

                    {/* Elenco */}
                    <ul className="max-h-80 divide-y divide-slate-700 overflow-y-auto px-5">
                        {newAlerts.map((h) => (
                            <li key={keyOf(h)} className="py-3">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-semibold">{h.hiker.name}</span>
                                    <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-300">
                                        Alert {h.alertNumber}/{h.totalAlerts}
                                    </span>
                                </div>
                                <p className="mt-1 text-sm text-slate-300">
                                    {h.destination} · expected back{" "}
                                    {new Date(h.expectedArrival).toLocaleString()}
                                </p>
                                {h.hiker.phone && (
                                    <p className="text-sm text-slate-400">Phone: {h.hiker.phone}</p>
                                )}
                            </li>
                        ))}
                    </ul>

                    {/* Pulsante */}
                    <div className="border-t border-slate-700 px-5 py-4">
                        <button
                            type="button"
                            onClick={dismiss}
                            autoFocus
                            className="flex w-full cursor-pointer items-center justify-center rounded-xl bg-red-600 px-5 py-3 font-semibold text-white transition-colors hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 active:bg-red-700"
                        >
                            I've seen it
                        </button>
                    </div>
                </div>
            </div>
        </>
    )
}