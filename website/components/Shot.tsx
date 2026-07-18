type ShotProps = {
  src: string;
  alt: string;
  label: string;
  width: number;
  height: number;
  /** 首屏圖片設 true:eager 載入 + 高優先權, 其餘 lazy。 */
  priority?: boolean;
};

/** 帶瀏覽器窗框的截圖。 */
export default function Shot({ src, alt, label, width, height, priority }: ShotProps) {
  return (
    <figure className="shot reveal">
      <div className="bar" aria-hidden="true">
        <i style={{ background: '#f57' }} />
        <i style={{ background: '#fb4' }} />
        <i style={{ background: '#5c6' }} />
        <span className="url">{label}</span>
      </div>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        draggable={false}
      />
    </figure>
  );
}
