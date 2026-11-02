import { FormEvent, ReactNode, useMemo, useRef, useState } from "react";

const destinations = [
  "Dallas Love Field",
  "DFW International Airport",
  "NorthPark Center",
  "Downtown Dallas",
  "University of Texas at Dallas",
  "Hughes-Trigg Student Center",
  "Fondren Library",
  "Dallas Hall",
  "SMU/Mockingbird Station",
];

type IconName =
  | "arrow"
  | "calendar"
  | "car"
  | "check"
  | "chevron"
  | "clock"
  | "home"
  | "map"
  | "pin"
  | "requests"
  | "search"
  | "seat"
  | "settings"
  | "user"
  | "x";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <path d="m15 18-6-6 6-6" />,
    calendar: (
      <>
        <path d="M7 3v3M17 3v3M4 9h16" />
        <rect x="4" y="5" width="16" height="16" rx="3" />
      </>
    ),
    car: (
      <>
        <path d="m5 16-1.5-1.5V11l2-5h13l2 5v3.5L19 16" />
        <path d="M5 16h14M7 11h10M7 16v2M17 16v2" />
        <circle cx="7" cy="13" r=".7" fill="currentColor" stroke="none" />
        <circle cx="17" cy="13" r=".7" fill="currentColor" stroke="none" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    map: (
      <>
        <path d="m4 6 5-3 6 3 5-3v15l-5 3-6-3-5 3Z" />
        <path d="M9 3v15M15 6v15" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    requests: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M8 11h8M8 15h5" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    seat: (
      <>
        <path d="M7 11V6a3 3 0 0 1 6 0v5M6 11h9a3 3 0 0 1 3 3v4H6Z" />
        <path d="M6 18v3M18 18v3M3 12v5a1 1 0 0 0 1 1h2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 13.5v-3l-2-.6-.7-1.7 1-1.8-2.1-2.1-1.8 1-1.7-.7-.6-2h-3l-.6 2-1.7.7-1.8-1-2.1 2.1 1 1.8-.7 1.7-2 .6v3l2 .6.7 1.7-1 1.8L4 19.7l1.8-1 1.7.7.6 2h3l.6-2 1.7-.7 1.8 1 2.1-2.1-1-1.8.7-1.7Z" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    x: <path d="m6 6 12 12M18 6 6 18" />,
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {paths[name]}
      </g>
    </svg>
  );
}

function StatusBar() {
  return (
    <div className="status-bar">
      <span>9:41</span>
      <div className="status-icons" aria-hidden="true">
        <span className="signal">▰</span>
        <span>⌁</span>
        <span className="battery" />
      </div>
    </div>
  );
}

function BottomNav() {
  const items: { icon: IconName; label: string }[] = [
    { icon: "home", label: "Home" },
    { icon: "map", label: "Map" },
    { icon: "requests", label: "Requests" },
    { icon: "user", label: "Profile" },
  ];
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {items.map((item) => (
        <button className={`nav-item ${item.label === "Home" ? "active" : ""}`} key={item.label}>
          <Icon name={item.icon} size={20} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="form-section">
      <div className="section-title">
        <span className="section-icon">
          <Icon name={icon} size={16} />
        </span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Home({ onOffer }: { onOffer: () => void }) {
  return (
    <div className="screen">
      <StatusBar />
      <main className="home-content">
        <header className="home-header">
          <div>
            <p className="eyebrow">Good evening,</p>
            <h1>Prince</h1>
            <span className="role-pill">Driving</span>
          </div>
          <button className="avatar" aria-label="Open profile">
            PE
          </button>
        </header>

        <div className="welcome-row">
          <div>
            <h2>Where are you headed?</h2>
            <p>Post where you’re going or find a ride with another Mustang.</p>
          </div>
          <button className="settings-button" aria-label="Settings">
            <Icon name="settings" size={20} />
          </button>
        </div>

        <div className="action-grid">
          <button className="action-card primary" onClick={onOffer}>
            <span className="action-icon">
              <Icon name="car" size={21} />
            </span>
            <strong>Offer a Ride</strong>
            <small>Share your open seats</small>
            <span className="action-arrow">→</span>
          </button>
          <button className="action-card secondary">
            <span className="action-icon orange">
              <Icon name="search" size={20} />
            </span>
            <strong>Find Riders</strong>
            <small>3 students looking now</small>
            <span className="action-arrow">→</span>
          </button>
        </div>

        <div className="rides-heading">
          <div>
            <span className="blue-line" />
            <h3>Available Rides</h3>
          </div>
          <span className="count-pill">3</span>
        </div>
        <div className="ride-filters">
          <button className="selected">Default</button>
          <button>Destination</button>
          <button>Departure</button>
        </div>
        <article className="ride-card">
          <div className="rider-row">
            <span className="rider-avatar">C</span>
            <div>
              <strong>Courtney</strong>
              <small><span className="online-dot" /> Driver · offering seats</small>
            </div>
            <span className="full-pill">Full</span>
          </div>
          <div className="route-line">
            <span className="route-markers"><i /><i /></span>
            <div>
              <small>Going to</small>
              <strong>Oak Lawn</strong>
            </div>
          </div>
          <div className="ride-meta">
            <span><Icon name="calendar" size={14} /> Today · 5:30 PM</span>
            <span><Icon name="seat" size={14} /> 3 seats</span>
          </div>
        </article>
      </main>
      <BottomNav />
    </div>
  );
}

function OfferRide({ onBack }: { onBack: () => void }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [destination, setDestination] = useState("");
  const [mapDestination, setMapDestination] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [seats, setSeats] = useState("");
  const [error, setError] = useState("");
  const [posted, setPosted] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredDestinations = useMemo(
    () => destinations.filter((item) => item.toLowerCase().includes(query.trim().toLowerCase())),
    [query],
  );

  function openSearch() {
    setDropdownOpen(true);
    setQuery(destination);
    setError("");
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }

  function chooseDestination(value: string) {
    setDestination(value);
    setQuery("");
    setDropdownOpen(false);
    setError("");
  }

  function submitRide(event: FormEvent) {
    event.preventDefault();
    if (!destination || !date || !time || !seats) {
      setError("Add a destination, departure time, and seat count to continue.");
      return;
    }
    setError("");
    setPosted(true);
  }

  if (posted) {
    return (
      <div className="screen">
        <StatusBar />
        <main className="success-content">
          <div className="success-mark">
            <Icon name="check" size={34} />
          </div>
          <p className="success-eyebrow">Ride posted</p>
          <h1>You’re ready to roll.</h1>
          <p className="success-copy">
            Your ride to <strong>{destination}</strong> is now visible to students looking for a seat.
          </p>
          <div className="success-card">
            <div>
              <span className="summary-icon"><Icon name="pin" size={18} /></span>
              <p><small>Destination</small><strong>{destination}</strong></p>
            </div>
            <div>
              <span className="summary-icon"><Icon name="calendar" size={18} /></span>
              <p><small>Departure</small><strong>{date} at {time}</strong></p>
            </div>
            <div>
              <span className="summary-icon"><Icon name="seat" size={18} /></span>
              <p><small>Available seats</small><strong>{seats} {seats === "1" ? "seat" : "seats"}</strong></p>
            </div>
          </div>
          <button className="primary-button" onClick={onBack}>Back to Home</button>
          <button className="text-button" onClick={() => setPosted(false)}>Edit ride details</button>
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="screen">
      <StatusBar />
      <header className="form-header">
        <button className="back-button" onClick={onBack} aria-label="Back to Home">
          <Icon name="arrow" size={20} /> Home
        </button>
        <div>
          <h1>Offer a Ride</h1>
          <p>Posting as Prince</p>
        </div>
        <button className="settings-button" aria-label="Settings">
          <Icon name="settings" size={20} />
        </button>
      </header>

      <form className="ride-form" onSubmit={submitRide}>
        <Section icon="pin" title="Route and destination">
          <label className="field-label" htmlFor="destination-search">Destination</label>
          <div className={`destination-combobox ${dropdownOpen ? "open" : ""}`}>
            <div className="search-field">
              <Icon name="search" size={18} />
              <input
                aria-expanded={dropdownOpen}
                aria-controls="destination-list"
                aria-autocomplete="list"
                autoComplete="off"
                id="destination-search"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setDropdownOpen(true);
                }}
                onClick={openSearch}
                placeholder="Search destinations"
                ref={searchRef}
                role="combobox"
                value={dropdownOpen ? query : destination}
              />
              {(destination || query) && (
                <button
                  className="clear-button"
                  onClick={() => {
                    setDestination("");
                    setQuery("");
                    setDropdownOpen(true);
                    searchRef.current?.focus();
                  }}
                  type="button"
                  aria-label="Clear destination"
                >
                  <Icon name="x" size={16} />
                </button>
              )}
              {!destination && !query && <Icon name="chevron" size={17} />}
            </div>
            {dropdownOpen && (
              <>
                <button
                  className="dropdown-scrim"
                  onClick={() => setDropdownOpen(false)}
                  type="button"
                  aria-label="Close destination search"
                />
                <div className="suggestion-list" id="destination-list" role="listbox">
                  {filteredDestinations.length > 0 ? (
                    filteredDestinations.map((item) => (
                      <button
                        className="suggestion"
                        key={item}
                        onClick={() => chooseDestination(item)}
                        role="option"
                        type="button"
                      >
                        <span><Icon name="pin" size={16} /></span>
                        <div>
                          <strong>{item}</strong>
                          <small>{item.includes("Dallas") || item.includes("DFW") ? "Dallas, TX" : "Campus & nearby"}</small>
                        </div>
                        <Icon name="chevron" size={15} />
                      </button>
                    ))
                  ) : (
                    <div className="empty-results">
                      <span><Icon name="search" size={21} /></span>
                      <strong>No destinations found</strong>
                      <small>Try “Dallas,” “SMU,” or “airport.”</small>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {destination && !dropdownOpen && (
            <p className="selected-hint"><Icon name="check" size={13} /> Preset destination selected</p>
          )}
        </Section>

        <Section icon="map" title="Optional map destination">
          <label className="map-field">
            <Icon name="pin" size={17} />
            <input
              onChange={(event) => setMapDestination(event.target.value)}
              placeholder="Add a map location"
              value={mapDestination}
            />
            <span>Optional</span>
          </label>
        </Section>

        <Section icon="calendar" title="Departure date and time">
          <div className="schedule-grid">
            <label className="schedule-field">
              <span><Icon name="calendar" size={18} /> Date</span>
              <input aria-label="Departure date" onChange={(event) => setDate(event.target.value)} type="date" value={date} />
            </label>
            <label className="schedule-field">
              <span><Icon name="clock" size={18} /> Time</span>
              <input aria-label="Departure time" onChange={(event) => setTime(event.target.value)} type="time" value={time} />
            </label>
          </div>
        </Section>

        <Section icon="seat" title="Available seats">
          <div className="seat-row">
            <div>
              <strong>Passenger seats</strong>
              <small>Driver not included</small>
            </div>
            <div className="seat-stepper">
              <button
                aria-label="Remove a seat"
                disabled={!seats || seats === "1"}
                onClick={() => setSeats(String(Math.max(1, Number(seats || 1) - 1)))}
                type="button"
              >
                −
              </button>
              <input
                aria-label="Available passenger seats"
                inputMode="numeric"
                max="7"
                min="1"
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "" || (/^[1-7]$/.test(value))) setSeats(value);
                }}
                placeholder="—"
                value={seats}
              />
              <button
                aria-label="Add a seat"
                disabled={seats === "7"}
                onClick={() => setSeats(String(Math.min(7, Number(seats || 0) + 1)))}
                type="button"
              >
                +
              </button>
            </div>
          </div>
        </Section>

        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="form-actions">
          <button className="primary-button" type="submit">
            <Icon name="car" size={18} /> Post Ride
          </button>
          <button className="cancel-button" onClick={onBack} type="button">Cancel</button>
        </div>
      </form>
      <BottomNav />
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<"home" | "offer">("home");

  return (
    <div className="app-shell">
      <div className="phone">
        {screen === "home" ? (
          <Home onOffer={() => setScreen("offer")} />
        ) : (
          <OfferRide onBack={() => setScreen("home")} />
        )}
      </div>
      <p className="prototype-note">Interactive CarpoolBoard prototype</p>
    </div>
  );
}
