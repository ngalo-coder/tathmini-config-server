const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

// Create a simple in-memory workflow generator if the file doesn't exist
const generateWorkflow = (project) => {
    return {
        name: `TathminiAI - ${project.name}`,
        nodes: [
            {
                id: "1",
                name: "Schedule Trigger",
                type: "n8n-nodes-base.scheduleTrigger",
                position: [250, 300],
                parameters: {
                    rule: {
                        interval: [{ field: "minutes", value: project.updateFrequency }]
                    }
                }
            },
            {
                id: "2", 
                name: "Fetch ODK Data",
                type: "n8n-nodes-base.httpRequest",
                position: [450, 300],
                parameters: {
                    url: `${project.odkConnection.url}/v1/projects/${project.odkConnection.projectId}/forms/${project.odkConnection.formId}/submissions`,
                    authentication: "genericCredentialType",
                    genericAuthType: "httpBasicAuth",
                    sendHeaders: true,
                    headerParameters: {
                        parameters: [
                            {
                                name: "Authorization",
                                value: "Bearer {{$credentials.token}}"
                            }
                        ]
                    }
                }
            }
        ],
        connections: {
            "Schedule Trigger": {
                "main": [
                    [
                        {
                            "node": "Fetch ODK Data",
                            "type": "main",
                            "index": 0
                        }
                    ]
                ]
            }
        }
    };
};

const app = express();

// CRITICAL: Use Railway's PORT
const PORT = process.env.PORT || 3000;

// Log startup
console.log('🚀 Starting TathminiAI Config Server...');
console.log(`📍 Environment PORT: ${process.env.PORT}`);
console.log(`📍 Using PORT: ${PORT}`);

// Middleware
app.use(cors());
app.use(express.json());

// IMPORTANT: Register API routes BEFORE static files
// File to store projects
const PROJECTS_FILE = path.join(__dirname, 'projects.json');

// Initialize projects file if it doesn't exist
async function initializeProjects() {
    try {
        await fs.access(PROJECTS_FILE);
        console.log('✅ Found existing projects file');
    } catch (error) {
        await fs.writeFile(PROJECTS_FILE, JSON.stringify([]));
        console.log('✅ Created new projects file');
    }
}

// Load projects from file
async function loadProjects() {
    try {
        const data = await fs.readFile(PROJECTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading projects:', error);
        return [];
    }
}

// Save projects to file
async function saveProjects(projects) {
    await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// Health check - MUST be before static files
app.get('/health', (req, res) => {
    console.log('✅ Health check requested');
    res.json({ 
        status: 'healthy', 
        port: PORT,
        timestamp: new Date().toISOString() 
    });
});

// Test route
app.get('/test', (req, res) => {
    res.json({ 
        message: 'Server is working!', 
        routes: ['/health', '/api/projects', '/api/test-connection']
    });
});

// API Routes - MUST be before static files
app.post('/api/test-connection', async (req, res) => {
    console.log('🔌 Testing ODK connection...');
    const { url, email, password, projectId, formId } = req.body;
    
    try {
        // For now, simulate a successful connection
        // In production, you'd actually test the ODK connection here
        console.log(`Testing connection to: ${url}`);
        
        // Simulate ODK authentication
        const authResponse = await fetch(`${url}/v1/sessions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password })
        });

        if (!authResponse.ok) {
            throw new Error('Authentication failed');
        }

        const { token } = await authResponse.json();
        
        res.json({ 
            success: true, 
            message: 'Connection successful',
            submissionCount: 1 
        });
    } catch (error) {
        console.error('❌ Connection test failed:', error.message);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/api/projects', async (req, res) => {
    console.log('📋 Fetching all projects');
    const projects = await loadProjects();
    console.log(`Found ${projects.length} projects`);
    res.json(projects);
});

app.post('/api/projects', async (req, res) => {
    console.log('➕ Creating new project');
    try {
        const projects = await loadProjects();
        const newProject = {
            id: Date.now().toString(),
            ...req.body,
            createdAt: new Date().toISOString()
        };
        
        projects.push(newProject);
        await saveProjects(projects);
        
        console.log('✅ Project created:', newProject.id);
        res.status(201).json(newProject);
    } catch (error) {
        console.error('❌ Failed to create project:', error);
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/projects/:id', async (req, res) => {
    console.log('🔧 Updating project:', req.params.id);
    try {
        const projects = await loadProjects();
        const index = projects.findIndex(p => p.id === req.params.id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        projects[index] = { ...projects[index], ...req.body };
        await saveProjects(projects);
        
        res.json(projects[index]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/projects/:id', async (req, res) => {
    console.log('🗑️ Deleting project:', req.params.id);
    try {
        const projects = await loadProjects();
        const filtered = projects.filter(p => p.id !== req.params.id);
        
        if (filtered.length === projects.length) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        await saveProjects(filtered);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:id/workflow', async (req, res) => {
    console.log('🔄 Generating workflow for project:', req.params.id);
    try {
        const projects = await loadProjects();
        const project = projects.find(p => p.id === req.params.id);
        
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        const workflow = generateWorkflow(project);
        res.json(workflow);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve static files LAST
app.use(express.static('public'));

// Catch all - serve index.html for any unmatched routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize and start server
async function start() {
    try {
        await initializeProjects();
        
        // Create HTTP server
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log('');
            console.log('✅ TathminiAI Configuration Server Started!');
            console.log(`📡 Server running on http://0.0.0.0:${PORT}`);
            console.log(`🌐 External URL: https://tathmini-config-server-production.up.railway.app`);
            console.log('');
            console.log('📍 Available endpoints:');
            console.log('  GET  /health');
            console.log('  GET  /api/projects');
            console.log('  POST /api/projects');
            console.log('  POST /api/test-connection');
            console.log('');
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            console.log('SIGTERM signal received: closing HTTP server');
            server.close(() => {
                console.log('HTTP server closed');
                process.exit(0);
            });
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
start();