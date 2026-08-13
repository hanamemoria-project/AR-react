/// <reference types="vite/client" />

declare namespace JSX {
    interface IntrinsicElements {
        'a-scene': any;
        'a-camera': any;
        'a-entity': any;
        'a-plane': any;
        'a-video': any;
        'a-assets': any;
        'a-image': any;
        'a-light': any;
    }
}

declare const AFRAME: any;


declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
