declare module '*.svg' {
  import type React from 'react';
  import type { SvgProps } from 'react-native-svg';
  const content: React.ComponentType<SvgProps>;
  export default content;
}
