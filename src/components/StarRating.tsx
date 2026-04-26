/**
 * StarRating — 재사용 가능한 별점 컴포넌트
 */
import { useState } from 'react';
import { Star } from 'lucide-react';

interface Props {
  rating: number;
  onChange?: (v: number) => void;
  size?: number;
  readonly?: boolean;
}

export function StarRating({ rating, onChange, size = 20, readonly = false }: Props) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(i)}
          onMouseEnter={() => !readonly && setHover(i)}
          onMouseLeave={() => setHover(0)}
          className={`transition-transform ${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'}`}
        >
          <Star
            size={size}
            className={`transition-colors ${
              i <= (hover || rating)
                ? 'fill-[#FFD700] text-[#FFD700]'
                : 'fill-transparent text-white/55'
            }`}
          />
        </button>
      ))}
    </div>
  );
}
