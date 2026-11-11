import { InfoPage } from "../components/InfoPage";

const SERVICES = [
  {
    name: "Meals",
    description:
      "The hut serves meals in a dining room with shared tables. Tables can be booked online, and dietary requirements and allergies can be added to the reservation. The dining room has shared tables of different sizes, so a party may sit with other hikers.",
  },
  {
    name: "Safety service for hikers setting off",
    description:
      "Hikers can register their excursion with the expected time of return and report their safe return to the system once they are back. If a hiker has not returned 2 hours after that time, notifications are sent and the hut starts a search. ",
  },
  {
    name: "Overnight stays",
    description: "Beds will be offered in the future. They cannot be booked yet.",
  },
];

export const ServicesPage = () => (
  <InfoPage title="Our services">


    <div className="mt-8 space-y-4">
      {SERVICES.map(({ name, status, description }) => (
        <article
          key={name}
          className="rounded-xl border border-white/10 bg-[#090f19] p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-sky-300">{name}</h2>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            {description}
          </p>
        </article>
      ))}
    </div>
  </InfoPage>
);