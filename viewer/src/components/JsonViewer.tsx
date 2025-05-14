import React from 'react';

interface JsonViewerProps {
  data: any;
}

const JsonViewer: React.FC<JsonViewerProps> = ({ data }) => {
  let content;
  try {
    content = JSON.stringify(data, null, 2);
  } catch (error) {
    console.error("Error stringifying JSON data:", error);
    content = "Error displaying JSON data.";
    // Optionally render the raw data if stringify fails
    // content = String(data);
  }

  return (
    <pre className="bg-gray-800 text-green-300 p-3 rounded-md overflow-auto text-xs border border-gray-700">
      {content}
    </pre>
  );
};

export default JsonViewer; 