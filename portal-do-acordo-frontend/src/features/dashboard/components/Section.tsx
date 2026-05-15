import type { ReactNode } from 'react';

type SectionProps = {
  num: string;
  title: string;
  children: ReactNode;
};

export function Section({ num, title, children }: SectionProps) {
  return (
    <section className="section-block">
      <div className="section-header">
        <span>{num}</span>
        <h2>{title}</h2>
        <div />
      </div>
      {children}
    </section>
  );
}
