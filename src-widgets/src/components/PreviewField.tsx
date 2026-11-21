import React from 'react';

import { Button } from '@mui/material';

import type {
    RxWidgetInfoAttributesField,
    RxWidgetInfoCustomComponentProperties,
    WidgetData,
} from '@iobroker/types-vis-2';

import { readScreensaverConfig } from '../lib/config';
import { t } from '../lib/i18n';
import ScreensaverRunner from './ScreensaverRunner';

interface PreviewButtonProps {
    data: WidgetData;
    props: RxWidgetInfoCustomComponentProperties;
}

/**
 * Shows the screensaver right away, as it will look - from the attributes, because in the editor a click on the
 * widget itself belongs to the editor. A touch or a key ends it, as in the runtime.
 *
 * @param props - the data of the widget and the context of the editor
 */
function PreviewButton(props: PreviewButtonProps): React.JSX.Element {
    // counts the previews, so that each one is a new screensaver that starts from the beginning
    const [seq, setSeq] = React.useState(0);
    const [open, setOpen] = React.useState(false);
    const { context, selectedView } = props.props;
    const folder = `${context.adapterName}.${context.instance}/${context.projectName}`;
    const project = React.useMemo(() => ({ url: `../${folder}`, folder }), [folder]);
    const config = React.useMemo(() => readScreensaverConfig(props.data), [props.data]);
    const candidates = React.useMemo(() => [{ id: 'preview', view: selectedView, config }], [selectedView, config]);

    return (
        <>
            <Button
                variant="outlined"
                size="small"
                fullWidth
                onClick={() => {
                    setSeq(seq + 1);
                    setOpen(true);
                }}
            >
                {t('preview')}
            </Button>
            {open ? (
                <ScreensaverRunner
                    key={seq}
                    socket={context.socket}
                    project={project}
                    candidates={candidates}
                    getView={() => selectedView}
                    watch={false}
                    startShown
                    onIdle={() => setOpen(false)}
                />
            ) : null}
        </>
    );
}

/**
 * The `component` of the `custom` attribute field with the preview button
 *
 * @param _field - the field
 * @param data - the data of the widget
 * @param _onDataChange - not used: the button changes nothing
 * @param props - the context of the editor
 */
export function renderPreviewField(
    _field: RxWidgetInfoAttributesField,
    data: WidgetData,
    _onDataChange: (newData: WidgetData) => void,
    props: RxWidgetInfoCustomComponentProperties,
): React.JSX.Element {
    return (
        <PreviewButton
            data={data}
            props={props}
        />
    );
}
