declare global {
  interface Window { AFRAME: any }
}


export function registerAframeComponents() {
  const AFRAMEObj = window.AFRAME;
  if (!AFRAMEObj) return;

  if (!AFRAMEObj.components['hider-material']) {
    AFRAMEObj.registerComponent('hider-material', {
      init: function () {
        let applyHider = () => {
          let mesh = this.el.getObject3D('mesh');
          if (mesh) {
            mesh.traverse(function (node: any) {
              if (node.isMesh) {
                node.material.colorWrite = false;
              }
            });
          }
        };
        this.el.addEventListener('model-loaded', applyHider);
        applyHider();
      }
    });
  }

  if (!AFRAME.components['float-anim']) {
    AFRAME.registerComponent('float-anim', {
      schema: {
        amplitude: { type: 'number', default: 0.015 },
        speed: { type: 'number', default: 1.5 }
      },
      init: function () {
        this.startY = this.el.object3D.position.y;
        this.time = 0;
      },
      tick: function (this: any, _t: number, dt: number) {
        this.time += (dt / 1000) * this.data.speed;
        this.el.object3D.position.y = this.startY + Math.sin(this.time) * this.data.amplitude;
      }
    });
  }

  if (!AFRAME.components['video-cover']) {
    AFRAME.registerComponent('video-cover', {
      schema: {
        planeRatio: { type: 'number', default: 0.5625 } // default 9:16
      },
      init: function () {
        this._applied = false;
        const videoEl = this.el.components.material?.material?.map?.image;
        if (videoEl && videoEl.videoWidth) {
          this._applyUV(videoEl);
        }
        this.el.addEventListener('materialvideoloadeddata', () => {
          const v = this.el.components.material?.material?.map?.image;
          if (v) this._applyUV(v);
        });
      },
      _applyUV: function (video: any) {
        if (this._applied) return;
        const mesh = this.el.getObject3D('mesh');
        if (!mesh || !mesh.geometry) return;

        const videoRatio = video.videoWidth / video.videoHeight;
        const planeRatio = this.data.planeRatio;

        let uScale = 1, vScale = 1, uOffset = 0, vOffset = 0;

        if (videoRatio < planeRatio) {
          vScale = videoRatio / planeRatio;
          vOffset = (1 - vScale) / 2;
        } else {
          uScale = planeRatio / videoRatio;
          uOffset = (1 - uScale) / 2;
        }

        const texture = this.el.components.material?.material?.map;
        if (texture) {
          texture.offset.set(uOffset, vOffset);
          texture.repeat.set(uScale, vScale);
          texture.needsUpdate = true;
          this._applied = true;
        }
      }
    });
  }
}
