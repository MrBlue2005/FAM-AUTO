const brandLetters = ['R', 'X', 'A', 'I', 'S', 't', 'u', 'd', 'i', 'o'];

export default function AnimatedBrand({ className = '' }) {
  return (
    <span className={`animated-brand ${className}`.trim()} aria-label="RX AI Studio">
      {brandLetters.map((letter, index) => (
        <span
          key={`${letter}-${index}`}
          className={index === 2 || index === 4 ? 'word-gap' : undefined}
          style={{ '--i': index }}
          aria-hidden="true"
        >
          {letter}
        </span>
      ))}
    </span>
  );
}
