import React from 'react';

interface DataTableProps {
  data: Record<string, string>[];
}

const DataTable: React.FC<DataTableProps> = ({ data }) => {
  if (!data || data.length === 0) return <p className="text-sm text-gray-500">No data to display or empty CSV.</p>;
  
  // Defensively check if data[0] exists before getting keys
  const headers = data.length > 0 ? Object.keys(data[0]) : [];
  if(headers.length === 0) return <p className="text-sm text-gray-500">CSV contains no header or data.</p>;

  return (
    <div className="overflow-x-auto text-xs">
      <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
        <thead className="bg-gray-50 sticky top-0 z-10">
          <tr>
            {headers.map(header => (
              <th key={header} scope="col" className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.map((row, rowIndex) => (
            <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {headers.map(header => (
                <td key={header} className="px-3 py-2 whitespace-nowrap">
                  {row[header]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DataTable; 