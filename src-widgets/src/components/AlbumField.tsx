import React from 'react';

import { MenuItem, TextField } from '@mui/material';

import type {
    RxWidgetInfoAttributesField,
    RxWidgetInfoCustomComponentProperties,
    WidgetData,
} from '@iobroker/types-vis-2';

import { askAdapter, type AdapterSocket } from '../lib/adapterAlbum';
import { readInstance } from '../lib/config';
import { t } from '../lib/i18n';

interface AlbumFieldProps {
    field: RxWidgetInfoAttributesField;
    data: WidgetData;
    onDataChange: (newData: WidgetData) => void;
    props: RxWidgetInfoCustomComponentProperties;
}

interface AlbumOption {
    value: string;
    label: string;
}

/** What the instance answered, and which instance it was */
interface AlbumsResult {
    instance: string;
    albums: AlbumOption[] | null;
}

/**
 * The album of the adapter: a select of the albums the instance has, or a text field where it does not answer
 * (stopped, or on another host that is offline) - the ID can be typed then.
 *
 * @param props - the field, the data of the widget and the context of the editor
 */
function AlbumInput(props: AlbumFieldProps): React.JSX.Element {
    const name = props.field.name || 'album';
    const value = typeof props.data[name] === 'string' ? (props.data[name]) : '';
    const instance = readInstance(props.data.instance);
    const socket = props.props.context.socket as unknown as AdapterSocket;
    const [result, setResult] = React.useState<AlbumsResult>({ instance: '', albums: null });

    React.useEffect(() => {
        let alive = true;
        askAdapter<unknown>(socket, instance, 'getAlbums', {}).then(
            answer => {
                if (alive) {
                    setResult({
                        instance,
                        albums: Array.isArray(answer)
                            ? (answer as AlbumOption[]).filter(album => album && typeof album.value === 'string')
                            : [],
                    });
                }
            },
            () => {
                if (alive) {
                    setResult({ instance, albums: null });
                }
            },
        );
        return () => {
            alive = false;
        };
    }, [socket, instance]);

    const current = result.instance === instance ? result : null;
    const set = (album: string): void => props.onDataChange({ ...props.data, [name]: album });

    if (current?.albums?.length) {
        const known = current.albums.some(album => album.value === value);
        return (
            <TextField
                select
                variant="standard"
                size="small"
                fullWidth
                value={value}
                onChange={e => set(e.target.value)}
            >
                {current.albums.map(album => (
                    <MenuItem
                        key={album.value}
                        value={album.value}
                    >
                        {album.label === album.value ? album.label : `${album.label} (${album.value})`}
                    </MenuItem>
                ))}
                {value && !known ? (
                    <MenuItem
                        key={value}
                        value={value}
                    >
                        {`${value} - ${t('album_gone')}`}
                    </MenuItem>
                ) : null}
            </TextField>
        );
    }

    let helper = '';
    if (!current) {
        helper = t('album_asking', instance);
    } else if (current.albums === null) {
        helper = t('album_unreachable', instance);
    } else {
        helper = t('album_none_configured', instance);
    }
    return (
        <TextField
            variant="standard"
            size="small"
            fullWidth
            value={value}
            placeholder="family"
            helperText={helper}
            onChange={e => set(e.target.value.trim())}
        />
    );
}

/**
 * The `component` of a `custom` attribute field
 *
 * @param field - the field
 * @param data - the data of the widget
 * @param onDataChange - writes the data of the widget
 * @param props - the context of the editor
 */
export function renderAlbumField(
    field: RxWidgetInfoAttributesField,
    data: WidgetData,
    onDataChange: (newData: WidgetData) => void,
    props: RxWidgetInfoCustomComponentProperties,
): React.JSX.Element {
    return (
        <AlbumInput
            field={field}
            data={data}
            onDataChange={onDataChange}
            props={props}
        />
    );
}
