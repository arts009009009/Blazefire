import React from 'react';

const logoUrl = new URL('../../assets/blazefire-logo.png', import.meta.url).href;

export function BlazefireLogo(props) {
  var size = props.size || 40;
  var style = props.style;

  return React.createElement('img', {
    src: logoUrl,
    width: size,
    height: size,
    alt: 'Blazefire',
    draggable: false,
    className: props.className || '',
    style: Object.assign({ objectFit: 'contain' }, style),
  });
}
