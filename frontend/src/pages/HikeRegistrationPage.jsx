import { useState } from "react";
import { useNavigate } from "react-router";
import hikeAPI from "../api/hike_api";

const initialForm = {
    destination: "",
    route: "",
    scheduledDeparture: "",
    expectedArrival: "",
    partySize: "1",
    passages: [],
    members: [],
};

const toISOString = (value) => new Date(value).toISOString();

// the party size is optional: if not given, the hiker alone
const partySizeOf = (value) => (value === "" ? 1 : Number(value));

const toLocalDateTimeInputValue = (date) => {
    const pad = (value) => String(value).padStart(2, "0");

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatDateTime = (value) =>
    new Date(value).toLocaleString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

export const HikeRegistrationPage = () => {
    const navigate = useNavigate();
    const minimumDeparture = toLocalDateTimeInputValue(new Date());
    const [formData, setFormData] = useState(initialForm);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [registeredHike, setRegisteredHike] = useState(null);

    const updateField = (field, value) => {
        setFormData((current) => ({ ...current, [field]: value }));
    };

    const updatePassage = (index, value) => {
        setFormData((current) => ({
            ...current,
            passages: current.passages.map((passage, passageIndex) =>
                passageIndex === index ? value : passage
            ),
        }));
    };

    const addPassage = () => {
        setFormData((current) => ({
            ...current,
            passages: [...current.passages, ""],
        }));
    };

    const removePassage = (index) => {
        setFormData((current) => ({
            ...current,
            passages: current.passages.filter((_, passageIndex) => passageIndex !== index),
        }));
    };

    const maxMembers = Math.max(0, partySizeOf(formData.partySize) - 1);

    const updateMember = (index, field, value) => {
        setFormData((current) => ({
            ...current,
            members: current.members.map((member, memberIndex) =>
                memberIndex === index
                    ? { ...member, [field]: value }
                    : member
            ),
        }));
    };

    const addMember = () => {
        setFormData((current) => {
            const partySize = partySizeOf(current.partySize);

            if (
                !Number.isInteger(partySize) ||
                current.members.length >= partySize - 1
            ) {
                return current;
            }

            return {
                ...current,
                members: [...current.members, { name: "", phone: "" }],
            };
        });
    };

    const removeMember = (index) => {
        setFormData((current) => ({
            ...current,
            members: current.members.filter(
                (_, memberIndex) => memberIndex !== index
            ),
        }));
    };

    const validate = () => {
        if (
            !formData.destination.trim() ||
            !formData.route.trim() ||
            !formData.scheduledDeparture ||
            !formData.expectedArrival
        ) {
            return "Complete all required fields.";
        }

        const departure = new Date(formData.scheduledDeparture);
        const arrival = new Date(formData.expectedArrival);
        const partySize = partySizeOf(formData.partySize);

        if (Number.isNaN(departure.getTime()) || Number.isNaN(arrival.getTime())) {
            return "Enter valid departure and arrival dates.";
        }

        if (departure.getTime() < Date.now()) {
            return "Departure must be in the future.";
        }

        if (arrival <= departure) {
            return "Expected arrival must be after departure.";
        }

        if (!Number.isInteger(partySize) || partySize <= 0) {
            return "Party size must be a positive whole number.";
        }

        if (formData.passages.some((passage) => !passage.trim())) {
            return "Remove empty passage fields or enter a passage name.";
        }

        if (formData.members.length > partySize - 1) {
            return "The number of party members cannot exceed the party size minus one.";
        }

        if (formData.members.some((member) => !member.name.trim())) {
            return "Remove empty party member fields or enter a member name.";
        }

        return "";
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError("");

        const validationError = validate();
        if (validationError) {
            setError(validationError);
            return;
        }

        setIsSubmitting(true);

        try {
            const hike = await hikeAPI.registerHike({
                destination: formData.destination.trim(),
                route: formData.route.trim(),
                scheduledDeparture: toISOString(formData.scheduledDeparture),
                expectedArrival: toISOString(formData.expectedArrival),
                ...(formData.partySize !== "" && { partySize: Number(formData.partySize) }),
                passages: formData.passages
                    .map((passage) => passage.trim())
                    .filter(Boolean),
                members: formData.members.map((member) => ({
                    name: member.name.trim(),
                    phone: member.phone.trim() || null,
                })),
            });
            setFormData(initialForm);
            setRegisteredHike(hike);
        } catch (submitError) {
            setError(
                submitError.message ||
                "The hike could not be registered. Please try again."
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    if (registeredHike) {
        return (
            <div className="flex w-full min-h-[calc(100vh-5rem)] items-center justify-center px-4 py-12">
                <div className="mx-auto w-full max-w-xl rounded-2xl border border-emerald-400/30 bg-[#0e1622]/90 p-8 shadow-xl">
                    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-400">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="26"
                            height="26"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M20 6 9 17l-5-5" />
                        </svg>
                    </div>

                    <h1 className="text-2xl font-bold text-white">
                        Hike registered!
                    </h1>
                    <p className="mt-2 text-sm text-slate-400">
                        Your planned hike has been registered successfully.
                    </p>

                    <div className="mt-6 space-y-3 rounded-xl border border-white/10 bg-[#090f19] p-5 text-sm">
                        <div className="flex justify-between gap-4">
                            <span className="text-slate-400">Hike reference</span>
                            <strong className="text-sky-300">
                                #{registeredHike.hikeId}
                            </strong>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-slate-400">Destination</span>
                            <strong className="break-words text-right text-white">
                                {registeredHike.destination}
                            </strong>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-slate-400">Route</span>
                            <strong className="break-words text-right text-white">
                                {registeredHike.route}
                            </strong>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-slate-400">Departure</span>
                            <strong className="text-right text-white">
                                {formatDateTime(registeredHike.scheduledDeparture)}
                            </strong>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-slate-400">Expected arrival</span>
                            <strong className="text-right text-white">
                                {formatDateTime(registeredHike.expectedArrival)}
                            </strong>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-slate-400">Party size</span>
                            <strong className="text-white">
                                {registeredHike.partySize}
                            </strong>
                        </div>

                        {registeredHike.members?.length > 0 && (
                            <div className="border-t border-white/10 pt-3">
                                <p className="mb-2 text-slate-400">Party members</p>
                                <ul className="list-inside list-disc space-y-1 text-slate-200">
                                    {registeredHike.members.map((member, index) => (
                                        <li key={index}>
                                            {member.name}
                                            {member.phone && (
                                                <span className="text-slate-400">
                                                    {" — "}{member.phone}
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {registeredHike.passages?.length > 0 && (
                            <div className="border-t border-white/10 pt-3">
                                <p className="mb-2 text-slate-400">Passages</p>
                                <ul className="list-inside list-disc space-y-1 text-slate-200">
                                    {registeredHike.passages.map((passage, index) => (
                                        <li key={`${passage}-${index}`}>{passage}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={() => navigate("/")}
                        className="mt-6 w-full cursor-pointer rounded-xl bg-sky-300 px-5 py-3 font-semibold text-slate-950 transition-colors hover:bg-sky-200"
                    >
                        Return to homepage
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex w-full min-h-[calc(100vh-5rem)] items-center justify-center px-4 py-12">
            <div className="relative w-full max-w-2xl rounded-3xl border border-white/10 bg-[#0e1622]/90 p-7 shadow-2xl shadow-black/20 sm:p-10">
                <button
                    type="button"
                    onClick={() => navigate("/")}
                    className="absolute left-6 top-6 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition-colors hover:border-sky-300/30 hover:bg-white/5 hover:text-sky-300"
                    aria-label="Back to homepage"
                >
                    <span aria-hidden="true">←</span>
                </button>

                <div className="mb-8 pt-8 text-center">
                    <h1 className="text-3xl font-bold tracking-tight text-white">
                        Register a hike
                    </h1>
                    <p className="mt-3 text-sm text-slate-400">
                        Tell us about your planned mountain hike before you leave.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                        <label className="block">
                            <span className="mb-2 block text-sm font-medium text-slate-200">
                                Destination
                            </span>
                            <input
                                type="text"
                                value={formData.destination}
                                onChange={(event) => updateField("destination", event.target.value)}
                                className="w-full rounded-xl border border-white/10 bg-[#172333] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/60 focus:ring-1 focus:ring-sky-300/30"
                                placeholder="Monte Rosa"
                                required
                            />
                        </label>

                        <label className="block">
                            <span className="mb-2 block text-sm font-medium text-slate-200">
                                Route
                            </span>
                            <input
                                type="text"
                                value={formData.route}
                                onChange={(event) => updateField("route", event.target.value)}
                                className="w-full rounded-xl border border-white/10 bg-[#172333] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/60 focus:ring-1 focus:ring-sky-300/30"
                                placeholder="Normal route"
                                required
                            />
                        </label>
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                        <label className="block">
                            <span className="mb-2 block text-sm font-medium text-slate-200">
                                Scheduled departure
                            </span>
                            <input
                                type="datetime-local"
                                min={minimumDeparture}
                                value={formData.scheduledDeparture}
                                onChange={(event) => updateField("scheduledDeparture", event.target.value)}
                                className="w-full rounded-xl border border-white/10 bg-[#172333] px-4 py-3 text-sm text-white outline-none transition-colors focus:border-sky-300/60 focus:ring-1 focus:ring-sky-300/30"
                                required
                            />
                        </label>

                        <label className="block">
                            <span className="mb-2 block text-sm font-medium text-slate-200">
                                Expected arrival
                            </span>
                            <input
                                type="datetime-local"
                                min={formData.scheduledDeparture || minimumDeparture}
                                value={formData.expectedArrival}
                                onChange={(event) => updateField("expectedArrival", event.target.value)}
                                className="w-full rounded-xl border border-white/10 bg-[#172333] px-4 py-3 text-sm text-white outline-none transition-colors focus:border-sky-300/60 focus:ring-1 focus:ring-sky-300/30"
                                required
                            />
                        </label>
                    </div>

                    <label className="block max-w-xs">
                        <span className="mb-2 block text-sm font-medium text-slate-200">
                            Party size <span className="font-normal text-slate-500">(optional)</span>
                        </span>
                        <input
                            type="number"
                            min="1"
                            step="1"
                            value={formData.partySize}
                            onChange={(event) => updateField("partySize", event.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-[#172333] px-4 py-3 text-sm text-white outline-none transition-colors focus:border-sky-300/60 focus:ring-1 focus:ring-sky-300/30"
                        />
                    </label>

                    <fieldset className="space-y-3">
                        <legend className="text-sm font-medium text-slate-200">
                            Party members <span className="font-normal text-slate-500">(optional)</span>
                        </legend>

                        <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                            <p>
                                Provide details for some or all of the other members of your party.
                            </p>
                            <span className="shrink-0">
                                {formData.members.length} / {maxMembers}
                            </span>
                        </div>

                        {formData.members.map((member, index) => (
                            <div
                                key={index}
                                className="space-y-3 rounded-xl border border-white/10 p-4"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-200">
                                        Member {index + 1}
                                    </span>

                                    <button
                                        type="button"
                                        onClick={() => removeMember(index)}
                                        className="rounded-xl border border-white/10 px-3 py-1 text-slate-400 transition-colors hover:border-red-400/40 hover:text-red-300"
                                        aria-label={`Remove member ${index + 1}`}
                                    >
                                        ×
                                    </button>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="block">
                                        <span className="mb-2 block text-sm font-medium text-slate-200">
                                            Name
                                        </span>
                                        <input
                                            type="text"
                                            value={member.name}
                                            onChange={(event) =>
                                                updateMember(index, "name", event.target.value)
                                            }
                                            className="w-full rounded-xl border border-white/10 bg-[#172333] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/60 focus:ring-1 focus:ring-sky-300/30"
                                            placeholder="Full name"
                                            required
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="mb-2 block text-sm font-medium text-slate-200">
                                            Phone <span className="font-normal text-slate-500">(optional)</span>
                                        </span>
                                        <input
                                            type="tel"
                                            value={member.phone}
                                            onChange={(event) =>
                                                updateMember(index, "phone", event.target.value)
                                            }
                                            className="w-full rounded-xl border border-white/10 bg-[#172333] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/60 focus:ring-1 focus:ring-sky-300/30"
                                            placeholder="Phone number"
                                        />
                                    </label>
                                </div>
                            </div>
                        ))}

                        <button
                            type="button"
                            onClick={addMember}
                            disabled={
                                !Number.isInteger(partySizeOf(formData.partySize)) ||
                                formData.members.length >= maxMembers
                            }
                            className="text-sm font-semibold text-sky-300 transition-colors hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            + Add member
                        </button>

                        {formData.members.length > maxMembers && (
                            <p className="text-sm text-red-300">
                                Remove extra party members or increase the party size.
                            </p>
                        )}
                    </fieldset>

                    <fieldset className="space-y-3">
                        <legend className="text-sm font-medium text-slate-200">
                            Passages <span className="font-normal text-slate-500">(optional)</span>
                        </legend>
                        {formData.passages.map((passage, index) => (
                            <div key={index} className="flex gap-2">
                                <input
                                    type="text"
                                    value={passage}
                                    onChange={(event) => updatePassage(index, event.target.value)}
                                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#172333] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/60 focus:ring-1 focus:ring-sky-300/30"
                                    placeholder={`Passage ${index + 1}`}
                                />
                                <button
                                    type="button"
                                    onClick={() => removePassage(index)}
                                    className="rounded-xl border border-white/10 px-3 text-slate-400 transition-colors hover:border-red-400/40 hover:text-red-300"
                                    aria-label={`Remove passage ${index + 1}`}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={addPassage}
                            className="text-sm font-semibold text-sky-300 transition-colors hover:text-sky-200"
                        >
                            + Add passage
                        </button>
                    </fieldset>

                    {error && (
                        <div role="alert" className="rounded-xl border-2 border-red-400 bg-[#172333] px-4 py-3 text-sm font-semibold text-red-300 shadow-xl">
                            {error}
                        </div>
                    )}
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="flex w-full items-center justify-center rounded-xl bg-sky-300 px-5 py-3 font-semibold text-slate-950 transition-colors hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isSubmitting ? "Registering..." : "Register hike"}
                    </button>
                </form>
            </div>
        </div>
    );
};
