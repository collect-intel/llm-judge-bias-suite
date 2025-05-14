import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// No CSV parsing needed anymore
// import Papa from 'papaparse';

/**
 * API route to fetch and parse a specific experiment data file (JSON).
 */
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const filePathRelative = searchParams.get('filePath'); // e.g., "picking_results_anthropic_claude-3.5-sonnet.json"

    if (!filePathRelative) {
        return NextResponse.json({ error: 'File path is required' }, { status: 400 });
    }

    // Construct the absolute path to the file
    const resultsDirName = 'tmp_report_output';
    // Correctly go up one level from viewer (process.cwd()) to the project root, then join with resultsDirName
    const baseDir = path.join(process.cwd(), '..', resultsDirName);
    const filePath = path.join(baseDir, filePathRelative);

    try {
        const fileContents = fs.readFileSync(filePath, 'utf-8');
        const jsonData = JSON.parse(fileContents);
        return NextResponse.json(jsonData);

    } catch (error: any) {
        console.error(`Error reading or parsing file ${filePath}:`, error);
        if (error.code === 'ENOENT') {
            return NextResponse.json({ error: `File not found: ${filePathRelative}` }, { status: 404 });
        }
        if (error instanceof SyntaxError) {
            return NextResponse.json({ 
                error: `Failed to parse JSON from file: ${filePathRelative}. Error: ${error.message}`,
                fileContentPreview: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8').substring(0, 500) + '...' : 'File not accessible for preview'
            }, { status: 500 });
        }
        return NextResponse.json({ error: `Failed to read or parse file: ${filePathRelative}` }, { status: 500 });
    }
} 