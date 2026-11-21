import React from 'react';

import { DialogSelectFile, type Connection } from '@iobroker/gui-components';
import type { VisTheme } from '@iobroker/types-vis-2';

import { t } from '../lib/i18n';

interface FolderDialogProps {
    socket: Connection;
    theme: VisTheme;
    selected: string;
    onClose: () => void;
    onSelect: (folder: string) => void;
}

/**
 * The file browser of ioBroker, for folders only. Loaded only when it is opened.
 *
 * @param props - where to start and what to do with the choice
 */
export default function FolderDialog(props: FolderDialogProps): React.JSX.Element {
    // the browser opens where the folder is, and starts in the folder of the user files otherwise
    const selected = (props.selected || '0_userdata.0').replace(/^(\.\.\/|\/)+/, '').replace(/\/+$/, '');
    return (
        <DialogSelectFile
            dialogName="vis2screensaverFolder"
            title={t('choose_folder')}
            socket={props.socket}
            theme={props.theme}
            themeType={props.theme?.palette?.mode}
            imagePrefix="../"
            selected={selected}
            selectOnlyFolders
            allowUpload
            allowCreateFolder
            allowDelete={false}
            allowDownload={false}
            filterByType="images"
            showToolbar
            onClose={props.onClose}
            onOk={value => {
                const folder = Array.isArray(value) ? value[0] : value;
                if (folder) {
                    props.onSelect(folder.replace(/\/+$/, ''));
                } else {
                    props.onClose();
                }
            }}
        />
    );
}
