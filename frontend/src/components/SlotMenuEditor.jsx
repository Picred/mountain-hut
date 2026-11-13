import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import capacityAPI from "../api/capacity_api";

const SlotMenuEditor = ({ slot, onMenuSaved, onMenuDeleted }) => {
    const [menu, setMenu] = useState(slot.menu ?? "");
    const [showPreview, setShowPreview] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const textareaRef = useRef(null);
    const [previousMenus, setPreviousMenus] = useState([]);
    const [loadingMenus, setLoadingMenus] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

    const isPastSlot = new Date(slot.startAt) <= new Date();

    useEffect(() => {
        if (isPastSlot) return;

        const loadPreviousMenus = async () => {
            try {
                setLoadingMenus(true);

                const menus = await capacityAPI.getPreviousMenus();

                setPreviousMenus(menus);
            } catch (err) {
                setError(
                    err.message || "Unable to retrieve previous menus."
                );
            } finally {
                setLoadingMenus(false);
            }
        };

        loadPreviousMenus();
    }, [isPastSlot]);

    const insertFormatting = (before, after = before) => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        const selectedText = menu.substring(start, end);

        const updatedMenu =
            menu.substring(0, start) +
            before +
            selectedText +
            after +
            menu.substring(end);

        if (updatedMenu.length > 2000) return;

        setMenu(updatedMenu);
        setSuccess("");
        setError("");

        requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(
                start + before.length,
                end + before.length
            );
        });
    };

    const insertList = (indent = "") => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        const lineStart = menu.lastIndexOf("\n", start - 1) + 1;

        const lineEndIndex = menu.indexOf("\n", end);
        const lineEnd = lineEndIndex === -1 ? menu.length : lineEndIndex;

        const selectedLines = menu.substring(lineStart, lineEnd);

        const formattedLines = selectedLines
            .split("\n")
            .map((line) => {
                const content = line.replace(/^\s*-\s+/, "");

                return `${indent}- ${content}`;
            })
            .join("\n");

        const updatedMenu =
            menu.substring(0, lineStart) +
            formattedLines +
            menu.substring(lineEnd);

        if (updatedMenu.length > 2000) return;

        setMenu(updatedMenu);
        setError("");
        setSuccess("");

        requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(
                lineStart,
                lineStart + formattedLines.length
            );
        });
    };

    const handleSave = async () => {
        setError("");
        setSuccess("");

        if (!menu.trim()) {
            setError("The menu cannot be empty.");
            return;
        }

        try {
            setSaving(true);

            const savedSlotMenu = await capacityAPI.saveSlotMenu(slot.slotId, menu);

            onMenuSaved(savedSlotMenu.menu);

            setSuccess("Menu saved successfully!");
        } catch (err) {
            setError(err.message || "Unable to save the menu.");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        setError("");
        setSuccess("");

        try {
            setDeleting(true);

            await capacityAPI.deleteSlotMenu(slot.slotId);

            setMenu("");
            setShowPreview(false);

            onMenuDeleted();
            setShowDeleteConfirmation(false);

            setSuccess("Menu deleted successfully!");
        } catch (err) {
            setError(err.message || "Unable to delete the menu.");
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="space-y-5">
            <div>
                <h4 className="text-lg font-semibold text-white">
                    {isPastSlot
                        ? "Slot Menu"
                        : slot.menu
                            ? "Edit Slot Menu"
                            : "Define Slot Menu"}
                </h4>

                <p className="mt-1 text-sm text-slate-400">
                    {isPastSlot
                        ? "This slot has already started. Its menu cannot be modified."
                        : "Write a new menu or reuse a previous one."}
                </p>
            </div>
            {!isPastSlot && (
                <div>
                    <label
                        htmlFor="previous-menu"
                        className="mb-2 block text-sm font-medium text-slate-300"
                    >
                        Reuse a Previous Menu
                    </label>

                    <select
                        id="previous-menu"
                        defaultValue=""
                        disabled={loadingMenus || previousMenus.length === 0}
                        onChange={(event) => {
                            const selectedMenu = previousMenus[Number(event.target.value)];

                            if (selectedMenu) {
                                setMenu(selectedMenu.menu);
                                setShowPreview(false);
                                setError("");
                                setSuccess("");
                            }
                        }}
                        className="w-full rounded-xl border border-white/15 bg-[#080e18] px-4 py-3 text-sm text-white outline-none transition focus:border-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <option value="">
                            {loadingMenus
                                ? "Loading previous menus..."
                                : previousMenus.length === 0
                                    ? "No previous menus available"
                                    : "Select a previous menu..."}
                        </option>

                        {previousMenus.map((previousMenu, index) => (
                            <option key={index} value={index}>
                                {previousMenu.menu
                                    .replace(/[#*_]/g, "")
                                    .replace(/\s+/g, " ")
                                    .trim()
                                    .slice(0, 80)}
                            </option>
                        ))}
                    </select>

                    <p className="mt-2 text-xs text-slate-400">
                        Selecting a previous menu copies its content into the editor.
                        You can modify it without changing the original menu.
                    </p>
                </div>
            )}
            {!isPastSlot && (
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => setShowPreview(false)}
                        className={`rounded-lg border px-4 py-2 text-sm font-medium cursor-pointer ${!showPreview
                            ? "bg-sky-300 text-slate-950 border-sky-300"
                            : "border-white/15 text-slate-300 hover:bg-white/10"
                            }`}
                    >
                        Edit
                    </button>

                    <button
                        type="button"
                        onClick={() => setShowPreview(true)}
                        className={`rounded-lg border px-4 py-2 text-sm font-medium cursor-pointer ${showPreview
                            ? "bg-sky-300 text-slate-950 border-sky-300"
                            : "border-white/15 text-slate-300 hover:bg-white/10"
                            }`}
                    >
                        Preview
                    </button>
                </div>
            )}

            {showPreview || isPastSlot ? (
                <div className="min-h-40 rounded-xl border border-white/10 bg-[#080e18] p-4 text-sm text-slate-200">
                    {menu.trim() ? (
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                ul: ({ children }) => (
                                    <ul className="my-2 list-disc pl-6">
                                        {children}
                                    </ul>
                                ),
                                ol: ({ children }) => (
                                    <ol className="my-2 list-decimal pl-6">
                                        {children}
                                    </ol>
                                ),
                                li: ({ children }) => (
                                    <li className="my-1">
                                        {children}
                                    </li>
                                ),
                            }}
                        >
                            {menu}
                        </ReactMarkdown>
                    ) : (
                        <p className="text-slate-400">
                            No menu defined for this slot.
                        </p>
                    )}
                </div>
            ) : (
                <div>
                    <div className="mb-3 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => insertFormatting("**")}
                            aria-label="Bold"
                            title="Bold"
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 font-bold text-white transition hover:bg-white/10 cursor-pointer"
                        >
                            B
                        </button>
                        <button
                            type="button"
                            onClick={() => insertFormatting("*")}
                            aria-label="Italic"
                            title="Italic"
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 font-serif italic text-white transition hover:bg-white/10 cursor-pointer"
                        >
                            I
                        </button>
                        <button
                            type="button"
                            onClick={() => insertList()}
                            aria-label="Bulleted List"
                            title="Bulleted List"
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white transition hover:bg-white/10 cursor-pointer"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <line x1="8" y1="6" x2="21" y2="6" />
                                <line x1="8" y1="12" x2="21" y2="12" />
                                <line x1="8" y1="18" x2="21" y2="18" />
                                <line x1="3" y1="6" x2="3.01" y2="6" />
                                <line x1="3" y1="12" x2="3.01" y2="12" />
                                <line x1="3" y1="18" x2="3.01" y2="18" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            onClick={() => insertList("  ")}
                            aria-label="Nested List"
                            title="Nested List"
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white transition hover:bg-white/10 cursor-pointer"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <circle cx="4" cy="5" r="0.35" />
                                <line x1="8" y1="5" x2="21" y2="5" />

                                <circle cx="10" cy="12" r="0.35" />
                                <line x1="14" y1="12" x2="21" y2="12" />

                                <circle cx="10" cy="19" r="0.35" />
                                <line x1="14" y1="19" x2="21" y2="19" />
                            </svg>
                        </button>
                    </div>
                    <textarea
                        ref={textareaRef}
                        value={menu}
                        onChange={(event) => setMenu(event.target.value)}

                        maxLength={2000}
                        rows={8}
                        placeholder={`**Lunch / Dinner Menu**
- Starter
  - ...
- First course
  - ...
- Main course
  - ...
- Side dish
  - ...
- Dessert
  - ...`}
                        className="w-full resize-y rounded-xl border border-white/15 bg-[#080e18] p-4 text-sm text-white outline-none transition focus:border-sky-300"
                    />

                    <p className="mt-2 text-right text-xs text-slate-400">
                        {menu.length} / 2000 characters
                    </p>
                </div>
            )}
            {!isPastSlot && (
                <div className="flex flex-wrap items-center justify-end gap-3">
                    {slot.menu && (
                        <button
                            type="button"
                            onClick={() => setShowDeleteConfirmation(true)}
                            disabled={deleting || saving}
                            className="cursor-pointer rounded-xl border border-red-500 bg-red-400 px-5 py-2.5 text-sm font-semibold text-[#0e1622] transition hover:bg-red-400 hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {deleting ? "Deleting..." : "Delete Menu"}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving || deleting || !menu.trim()}
                        className="rounded-xl bg-sky-300 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    >
                        {saving ? "Saving..." : "Save Menu"}
                    </button>
                </div>
            )}

            {showDeleteConfirmation && (
                <div className="rounded-xl border border-red-400/30 bg-red-400/5 p-4">
                    <div className="flex items-start gap-3">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="mt-0.5 shrink-0 text-red-400"
                        >
                            <path d="m10.29 3.86-8.47 14.14A2 2 0 0 0 3.53 21h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>

                        <div>
                            <h5 className="text-sm font-semibold text-white">
                                Delete this menu?
                            </h5>
                            <p className="mt-1 text-sm text-slate-400">
                                Are you sure you want to delete this menu?
                                This action cannot be undone.
                            </p>
                        </div>
                    </div>

                    <div className="mt-4 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={() => setShowDeleteConfirmation(false)}
                            disabled={deleting}
                            className="cursor-pointer rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
                        >
                            Cancel
                        </button>

                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={deleting}
                            className="cursor-pointer rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {deleting ? "Deleting..." : "Confirm Delete"}
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <p role="alert" className="text-sm text-red-400">
                    {error}
                </p>
            )}

            {success && (
                <p role="status" className="text-sm text-emerald-300">
                    {success}
                </p>
            )}
        </div>
    );
};

export default SlotMenuEditor;