// D3: shared scroll fade-up wrapper for landing sections.
// Triggers once when section enters viewport (10% margin) — Linear/Vercel tone.
// Uses framer-motion (already a dep). Prefers reduced-motion respected by framer-motion automatically.
import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';

interface MotionSectionProps extends Omit<HTMLMotionProps<'section'>, 'children'> {
  children: ReactNode;
}

export function MotionSection({ children, ...rest }: MotionSectionProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      {...rest}
    >
      {children}
    </motion.section>
  );
}
