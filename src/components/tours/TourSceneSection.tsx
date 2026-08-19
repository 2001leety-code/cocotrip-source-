// TourSceneSection — 투어 상세 페이지 매거진형 "SCENE" 에디토리얼 섹션.
// getTourScenes(tourId) 가 빈 배열이면 섹션 자체를 렌더하지 않는다(탭 배선도 마찬가지).
// 사진은 GuideIndexBody.tsx 의 GuidePhoto 철학을 따른다 — 깨진 이미지는 틀째 제거
// (플레이스홀더 박스를 두지 않는다).
import { useState } from 'react';
import type { Language } from '@/i18n';
import { pickTourDetailEditorialCopy } from '@/pages/tourDetailEditorialCopy';
import { getTourScenes } from './tourSceneData';

function ScenePhoto({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className="tour-detail-scene-photo"
    />
  );
}

export function TourSceneSection({ tourId, language }: { tourId: string; language: Language }) {
  const scenes = getTourScenes(tourId);
  if (scenes.length === 0) return null;
  const copy = pickTourDetailEditorialCopy(language);

  return (
    <section id="scenes" className="tour-detail-section tour-detail-scene-section">
      <h2 className="ec-h2 tour-detail-section-heading">{copy.scenesLabel}</h2>
      <div className="tour-detail-scene-list">
        {scenes.map((scene, index) => {
          const title = scene.title[language] || scene.title.en;
          const body = scene.body[language] || scene.body.en;
          const kicker = `SCENE ${String(index + 1).padStart(2, '0')}`;
          return (
            <article key={index} className="tour-detail-scene" data-scene-index={index}>
              <ScenePhoto src={scene.photo} alt={title} />
              <div className="tour-detail-scene-copy">
                <p className="ec-eyebrow text-ec-brand tour-detail-scene-kicker">{kicker}</p>
                <h3 className="ec-h3 tour-detail-scene-title">{title}</h3>
                <p className="ec-body ec-measure tour-detail-scene-body">{body}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
