import React from 'react';

import { IconButton, TextField } from '@mui/material';

import type {
    RxWidgetInfoAttributesField,
    RxWidgetInfoCustomComponentProperties,
    WidgetData,
} from '@iobroker/types-vis-2';

import { t } from '../lib/i18n';
import FolderDialog from './FolderDialogLazy';

interface FolderFieldProps {
    field: RxWidgetInfoAttributesField;
    data: WidgetData;
    onDataChange: (newData: WidgetData) => void;
    props: RxWidgetInfoCustomComponentProperties;
}

/**
 * The folder of the pictures: typed, or chosen in the file browser of ioBroker - where pictures can be uploaded
 * and folders created as well, so nobody has to leave the editor for the file manager.
 *
 * @param props - the field, the data of the widget and the context of the editor
 */
function FolderInput(props: FolderFieldProps): React.JSX.Element {
    const name = props.field.name || 'folder';
    const value = typeof props.data[name] === 'string' ? props.data[name] : '';
    const [open, setOpen] = React.useState(false);

    return (
        <>
            <TextField
                variant="standard"
                size="small"
                fullWidth
                value={value}
                placeholder="0_userdata.0/fotos"
                onChange={e => props.onDataChange({ ...props.data, [name]: e.target.value })}
                slotProps={{
                    input: {
                        endAdornment: (
                            <IconButton
                                size="small"
                                title={t('choose_folder')}
                                onClick={() => setOpen(true)}
                            >
                                <svg
                                    viewBox="0 0 24 24"
                                    width={18}
                                    height={18}
                                    fill="currentColor"
                                    aria-hidden="true"
                                >
                                    <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
                                </svg>
                            </IconButton>
                        ),
                    },
                }}
            />
            {open ? (
                <React.Suspense fallback={null}>
                    <FolderDialog
                        socket={props.props.context.socket}
                        theme={props.props.context.theme}
                        selected={value}
                        onClose={() => setOpen(false)}
                        onSelect={folder => {
                            setOpen(false);
                            props.onDataChange({ ...props.data, [name]: folder });
                        }}
                    />
                </React.Suspense>
            ) : null}
        </>
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
export function renderFolderField(
    field: RxWidgetInfoAttributesField,
    data: WidgetData,
    onDataChange: (newData: WidgetData) => void,
    props: RxWidgetInfoCustomComponentProperties,
): React.JSX.Element {
    return (
        <FolderInput
            field={field}
            data={data}
            onDataChange={onDataChange}
            props={props}
        />
    );
}
