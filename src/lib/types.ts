import type { ImmichDockerSettings } from './immichDocker';

/** Where an album takes its pictures from */
export type AlbumType = 'storage' | 'path' | 'immich' | 'google';

/** An album as configured in the instance */
export interface AlbumConfig {
    enabled: boolean;
    /** What the widgets name: letters, digits, `-` and `_` */
    id: string;
    name: string;
    type: AlbumType;
    /**
     * `storage`: a folder of the ioBroker file storage, like `0_userdata.0/fotos`;
     * `path`: a folder of the server, like `/mnt/nas/fotos`;
     * `immich`: the name or id of an album, empty for the whole library;
     * `google`: the name or id of a source chosen in the Google Photos app, empty for the selection of Google
     */
    location: string;
    /** Include subfolders (`storage`, `path`) */
    recursive: boolean;
}

/** The settings of the instance */
export interface ScreensaverAdapterConfig {
    albums: AlbumConfig[];
    immichUrl: string;
    immichApiKey: string;
    /** The longest edge of a reduced picture, in pixels */
    maxEdge: number;
    /** How large the cache of reduced pictures may grow, in MB */
    cacheSizeMb: number;
    /** Read the albums again after this many minutes */
    rescanMinutes: number;
    /** Immich in Docker on this host (`docker-compose.yaml`); also read by `@iobroker/plugin-docker` */
    dockerImmich?: Partial<ImmichDockerSettings>;
    /** The account of Immich in Docker: created on a new Immich, else used to sign in when a key is needed */
    immichEmail?: string;
    immichPassword?: string;
}

/** A picture as an album knows it */
export interface Picture {
    /** Unique in the album: the path inside the folder, or the id of the asset */
    key: string;
    /** The file name */
    name: string;
    /** When it was taken, floating (see `dateFilter.ts`) */
    date?: number;
    /** As shown, the orientation applied */
    width?: number;
    height?: number;
    /** Written into the file or known to the photo service: city, country */
    place?: string;
    caption?: string;
    latitude?: number;
    longitude?: number;
    /** To see that a file changed: its size and time, or what the service says */
    size?: number;
    version?: string;
}

/** What `list` answers: the pictures a widget shows, in the short form the widgets read */
export interface ListedPicture {
    /** The key */
    k: string;
    /** Taken, `YYYY-MM-DDTHH:mm:ss` wall-clock time */
    d?: string;
    w?: number;
    h?: number;
    /** Place */
    p?: string;
    /** Caption */
    c?: string;
}

export interface ListAnswer {
    pictures?: ListedPicture[];
    /** Pictures in the album */
    total?: number;
    /** Pictures that passed the filter */
    matched?: number;
    /** None passed the filter, and the widget asked for all instead */
    fallback?: boolean;
    /** The album is read for the first time: more pictures will come */
    scanning?: boolean;
    error?: 'album_not_found' | 'album_failed';
    /** With `album_failed`: why, as the source said it (like `Immich has no album "x"`) */
    reason?: string;
}

export interface PictureAnswer {
    /** The file in the storage, like `screensaver.0/cache/fotos/1a2b_1920.jpg`; relative to the files of the server */
    url?: string;
    error?: 'album_not_found' | 'picture_not_found' | 'picture_failed';
}
