export default function ComingSoonPage({ title, description, cards = [] }) {
  return (
    <section className="panel">
      <p className="eyebrow">Coming soon</p>
      <h1>{title}</h1>

      <p className="muted">
        {description ||
          "This section will be built after the iREPS Desktop shell is complete."}
      </p>

      {cards.length > 0 ? (
        <div className="placeholder-grid">
          {cards.map((card) => (
            <div className="placeholder-card" key={card.title}>
              <h3>{card.title}</h3>
              <p className="muted">{card.description}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
