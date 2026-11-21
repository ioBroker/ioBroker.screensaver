import React from 'react';

import type { FrameConfig } from '../lib/config';
import { lookupPlace } from '../lib/geocode';
import type { PreparedPhoto } from '../lib/photoLoader';
import { TEXT_SHADOW } from './styles';

/**
 * Where the photo was taken: from the list, from the file, or - where the user allowed it - looked up from the
 * GPS coordinates at OpenStreetMap. The lookup arrives later, the caption shows the rest meanwhile.
 *
 * @param photo - the picture
 * @param config - the settings
 * @param lang - the language of the name
 */
function usePlace(photo: PreparedPhoto, config: FrameConfig, lang: string): string | undefined {
    const known = config.placeSource === 'off' ? undefined : photo.ref.place || photo.meta.place;
    const { latitude, longitude } = photo.meta;
    const lookup = !known && config.placeSource === 'osm' && latitude !== undefined && longitude !== undefined;
    const [found, setFound] = React.useState<string | undefined>(undefined);

    React.useEffect(() => {
        if (!lookup) {
            return undefined;
        }
        let alive = true;
        void lookupPlace(latitude, longitude, lang).then(place => alive && setFound(place || undefined));
        return () => {
            alive = false;
        };
    }, [lookup, latitude, longitude, lang]);

    return known || (lookup ? found : undefined);
}

export interface CaptionProps {
    photo: PreparedPhoto;
    config: FrameConfig;
    lang: string;
    /** The width of the space the caption belongs to: the frame, or half of it for a pair */
    width: number;
    height: number;
    /** Where it sits; for a pair or when the clock takes the corner it may be the other corner */
    position: 'bottomLeft' | 'bottomRight';
}

/**
 * The caption of a picture: the text of the picture or the free text, and under it the date and the place.
 *
 * It belongs to its picture and fades or slides with it, so it is drawn inside the layer of the slide.
 *
 * @param props - the picture and how to show its caption
 */
export default function Caption(props: CaptionProps): React.JSX.Element | null {
    const { photo, config, lang } = props;
    const place = usePlace(photo, config, lang);
    const date = config.showDate ? photo.ref.date || photo.meta.date : undefined;
    const caption = (config.showPhotoCaption ? photo.ref.caption || photo.meta.caption : undefined) || config.captionText;

    const line2 = [
        date ? date.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }) : '',
        place || '',
    ]
        .filter(Boolean)
        .join(' · ');

    if (!caption && !line2) {
        return null;
    }
    if (props.width < 120 || props.height < 90) {
        return null;
    }

    const size = Math.max(11, Math.min(28, Math.min(props.width, props.height) * 0.045));
    const pad = Math.max(8, Math.min(props.width, props.height) * 0.05);
    const right = props.position === 'bottomRight';

    return (
        <>
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: '35%',
                    pointerEvents: 'none',
                    background: 'linear-gradient(to top, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0))',
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    bottom: pad,
                    left: right ? undefined : pad,
                    right: right ? pad : undefined,
                    maxWidth: `calc(100% - ${pad * 2}px)`,
                    color: '#fff',
                    textShadow: TEXT_SHADOW,
                    textAlign: right ? 'right' : 'left',
                    pointerEvents: 'none',
                    lineHeight: 1.25,
                }}
            >
                {caption ? (
                    <div
                        style={{
                            fontSize: size,
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                        }}
                    >
                        {caption}
                    </div>
                ) : null}
                {line2 ? (
                    <div
                        style={{
                            fontSize: size * 0.82,
                            opacity: 0.9,
                            marginTop: caption ? size * 0.15 : 0,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}
                    >
                        {line2}
                    </div>
                ) : null}
            </div>
        </>
    );
}
