import { ImageResponse } from 'next/og';
import React from 'react';

// Route segment config
export const runtime = 'edge';

// Image metadata
export const size = {
  width: 32,
  height: 32,
};
export const contentType = 'image/png'; // Or image/x-icon for .ico, image/svg+xml for svg

// Image generation
export default function Icon() {
  return new ImageResponse(
    (
      // ImageResponse JSX element
      <div
        style={{
          fontSize: 22, // Adjusted for 32x32 size
          background: '#2c3e50', // Dark blue-grey
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ecf0f1', // Light grey/white
          borderRadius: '4px',
          fontFamily: 'monospace',
          fontWeight: 'bold',
        }}
      >
        LJB
      </div>
    ),
    // ImageResponse options
    {
      // For convenience, we can re-use the exported icons size metadata
      ...size,
    }
  );
} 