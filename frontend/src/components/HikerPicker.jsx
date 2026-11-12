import { useState, useEffect } from "react";
import { searchHikers } from "../api/reservation_api";

const TABS = [
  { id: "existing", label: "Existing hiker" },
  { id: "new", label: "New hiker" },
  { id: "quick", label: "Quick entry" },
];

const MIN_SEARCH_LENGTH = 2;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  "w-full rounded-xl border border-white/15 bg-[#0e1622] px-4 py-3 text-sm text-white outline-none focus:border-sky-300";
const labelClass = "mb-2 block text-sm font-medium text-slate-300";

/**
 * Calls onChange with the hiker in the format of the backend, or with null
 * while the data of the active tab is missing or invalid:
 * - existing hiker: { userId }
 * - new hiker with a web account: { name, email, phone }. The backend generates a
 *   temporary password, which the hiker must change at the first login.
 * - quick entry (temporary hiker): { name, phone? }
 */
export const HikerPicker = ({ onChange }) => {
  const [tab, setTab] = useState("existing");

  // Search of a registered hiker.
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [selected, setSelected] = useState(null);

  // New hiker with full details.
  const [newHiker, setNewHiker] = useState({
    name: "",
    email: "",
    phone: "",
  });

  // Temporary hiker.
  const [quickHiker, setQuickHiker] = useState({ name: "", phone: "" });

  const trimmedSearch = searchText.trim();
  const searchIsLongEnough = trimmedSearch.length >= MIN_SEARCH_LENGTH;

  // Search while the employee types, waiting for a short pause.
  useEffect(() => {
    if (!searchIsLongEnough) {
      setResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    // Ignore the answer of an outdated search.
    let isCancelled = false;
    setIsSearching(true);
    setSearchError(null);

    const timer = setTimeout(async () => {
      try {
        const found = await searchHikers(trimmedSearch);
        if (!isCancelled) setResults(found);
      } catch (err) {
        if (!isCancelled) {
          setResults([]);
          setSearchError(err.message || "Unable to search hikers.");
        }
      } finally {
        if (!isCancelled) setIsSearching(false);
      }
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedSearch, searchIsLongEnough]);

  // Validation of the new hiker form.
  const emailError =
    newHiker.email.trim() && !EMAIL_PATTERN.test(newHiker.email.trim())
      ? "Enter a valid email address."
      : null;

  // Send the hiker of the active tab to the page.
  useEffect(() => {
    let hiker = null;

    if (tab === "existing") {
      if (selected) hiker = { userId: selected.userId };
    } else if (tab === "new") {
      const name = newHiker.name.trim();
      const email = newHiker.email.trim();
      const phone = newHiker.phone.trim();

      if (name && email && phone && EMAIL_PATTERN.test(email)) {
        hiker = { name, email, phone };
      }
    } else if (quickHiker.name.trim()) {
      const phone = quickHiker.phone.trim();
      hiker = phone
        ? { name: quickHiker.name.trim(), phone }
        : { name: quickHiker.name.trim() };
    }

    onChange(hiker);
  }, [tab, selected, newHiker, quickHiker, onChange]);

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-300 font-bold text-slate-950">
          1
        </span>
        <h2 className="text-lg font-semibold text-white">
          Who is the reservation for?
        </h2>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#0e1622]/90 p-5 shadow-xl sm:p-6">
        {/* Choice of how the hiker is entered. */}
        <div
          role="tablist"
          className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {TABS.map(({ id, label }) => (
            <button
              type="button"
              role="tab"
              key={id}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`cursor-pointer rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === id
                  ? "border-sky-300 bg-sky-300/10 text-sky-200"
                  : "border-white/10 bg-[#090f19] text-slate-300 hover:border-sky-300/40 hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "existing" && (
          <div className="space-y-4">
            <div>
              <label htmlFor="hiker-search" className={labelClass}>
                Search by name, email or phone
              </label>
              <input
                id="hiker-search"
                type="search"
                autoComplete="off"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="e.g. Maria, maria@example.com, 333…"
                className={inputClass}
              />
            </div>

            {selected && (
              <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-emerald-300">
                    Selected hiker
                  </p>
                  <p className="mt-1 font-semibold text-white">
                    {selected.name}
                  </p>
                  <p className="break-words text-slate-300">
                    {[selected.email, selected.phone]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="shrink-0 cursor-pointer text-xs font-medium text-slate-300 underline hover:text-white"
                >
                  Change
                </button>
              </div>
            )}

            {!selected &&
              (!searchIsLongEnough ? (
                <p className="rounded-xl border border-dashed border-white/15 bg-[#090f19] p-4 text-center text-sm text-slate-400">
                  Type at least {MIN_SEARCH_LENGTH} characters to search.
                </p>
              ) : isSearching ? (
                <div className="flex items-center justify-center gap-3 py-4 text-sm text-slate-400">
                  <span className="loading loading-spinner loading-sm text-sky-300" />
                  Searching...
                </div>
              ) : searchError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-300"
                >
                  {searchError}
                </p>
              ) : results.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/15 bg-[#090f19] p-4 text-center text-sm text-slate-400">
                  No hiker found. Try another search, or use "New hiker" or
                  "Quick entry".
                </p>
              ) : (
                <ul className="max-h-64 space-y-2 overflow-y-auto">
                  {results.map((hiker) => (
                    <li key={hiker.userId}>
                      <button
                        type="button"
                        onClick={() => setSelected(hiker)}
                        className="w-full cursor-pointer rounded-xl border border-white/10 bg-[#090f19] px-4 py-3 text-left transition-colors hover:border-sky-300/40 hover:bg-white/5"
                      >
                        <span className="block text-sm font-medium text-white">
                          {hiker.name}
                        </span>
                        <span className="block break-words text-xs text-slate-400">
                          {[hiker.email, hiker.phone]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        )}

        {tab === "new" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              A regular hiker profile is created with a temporary password, shown
              after the reservation. The hiker must change it at the first login.
            </p>

            <div>
              <label htmlFor="new-hiker-name" className={labelClass}>
                Name
              </label>
              <input
                id="new-hiker-name"
                type="text"
                autoComplete="off"
                value={newHiker.name}
                onChange={(e) =>
                  setNewHiker({ ...newHiker, name: e.target.value })
                }
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="new-hiker-email" className={labelClass}>
                Email
              </label>
              <input
                id="new-hiker-email"
                type="email"
                autoComplete="off"
                value={newHiker.email}
                onChange={(e) =>
                  setNewHiker({ ...newHiker, email: e.target.value })
                }
                className={inputClass}
              />
              {emailError && (
                <p className="mt-2 text-xs text-red-300">{emailError}</p>
              )}
            </div>

            <div>
              <label htmlFor="new-hiker-phone" className={labelClass}>
                Phone
              </label>
              <input
                id="new-hiker-phone"
                type="tel"
                autoComplete="off"
                value={newHiker.phone}
                onChange={(e) =>
                  setNewHiker({ ...newHiker, phone: e.target.value })
                }
                className={inputClass}
              />
            </div>
          </div>
        )}

        {tab === "quick" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              A temporary hiker is created: it cannot log in or use the web
              interface.
            </p>

            <div>
              <label htmlFor="quick-hiker-name" className={labelClass}>
                Name
              </label>
              <input
                id="quick-hiker-name"
                type="text"
                autoComplete="off"
                value={quickHiker.name}
                onChange={(e) =>
                  setQuickHiker({ ...quickHiker, name: e.target.value })
                }
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="quick-hiker-phone" className={labelClass}>
                Phone (optional)
              </label>
              <input
                id="quick-hiker-phone"
                type="tel"
                autoComplete="off"
                value={quickHiker.phone}
                onChange={(e) =>
                  setQuickHiker({ ...quickHiker, phone: e.target.value })
                }
                className={inputClass}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
};