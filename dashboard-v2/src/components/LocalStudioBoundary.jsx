export default function LocalStudioBoundary({ title, description }) {
  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <span className="hero-eyebrow">LOCAL STUDIO</span>
          <h1>{title}</h1>
          <p>{description || 'Acest instrument este disponibil în Local Studio pe dispozitiv.'}</p>
        </div>
      </header>
      <section className="editor-panel">
        <h2>Disponibil local</h2>
        <p>Controalele de runtime, configurarea browserului și datele de diagnostic rămân disponibile numai în Local Studio pe dispozitiv.</p>
      </section>
    </div>
  );
}
