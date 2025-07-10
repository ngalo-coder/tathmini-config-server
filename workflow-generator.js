// =============================================================================
// FILE 1: workflow-generator.js
// =============================================================================

// Dynamic n8n Workflow Generator
// File: workflow-generator.js

class WorkflowGenerator {
    constructor() {
        this.templateWorkflow = this.getBaseTemplate();
    }

    // Generate a complete n8n workflow for a project
    generateWorkflow(project) {
        const workflow = JSON.parse(JSON.stringify(this.templateWorkflow));
        
        // Update workflow name
        workflow.name = `TathminiAI - ${project.title}`;
        
        // Update nodes with project-specific configuration
        this.updateNodes(workflow.nodes, project);
        
        return workflow;
    }

    // Update nodes with project configuration
    updateNodes(nodes, project) {
        nodes.forEach(node => {
            switch (node.name) {
                case 'Schedule Trigger':
                    this.updateScheduleTrigger(node, project);
                    break;
                case 'Fetch ODK Submissions':
                    this.updateODKFetch(node, project);
                    break;
                case 'Process Submissions Data':
                    this.updateProcessingNode(node, project);
                    break;
                case 'Prepare Submissions for Airtable':
                    this.updateSubmissionsPrep(node, project);
                    break;
                case 'Prepare Summary for Airtable':
                    this.updateSummaryPrep(node, project);
                    break;
                case 'Store in Airtable - Individual Submissions':
                case 'Store in Airtable - Summary':
                    this.updateAirtableNodes(node, project);
                    break;
            }
        });
    }

    // Update schedule trigger with project sync interval
    updateScheduleTrigger(node, project) {
        node.parameters.rule.interval[0].minutesInterval = project.syncInterval;
    }

    // Update ODK fetch node with project details
    updateODKFetch(node, project) {
        const bodyData = {
            projectId: project.odkProjectId,
            formId: project.odkFormId,
            lastSync: null
        };
        
        node.parameters.jsonBody = JSON.stringify(bodyData, null, 2);
        
        // Update URL if using different MCP server
        if (project.mcpServerUrl) {
            node.parameters.url = `${project.mcpServerUrl}/odk-mcp/tools/fetch_submissions`;
        }
    }

    // Update processing node with project-specific details
    updateProcessingNode(node, project) {
        // Inject project details into the code
        let jsCode = node.parameters.jsCode;
        
        // Replace project ID and form ID
        jsCode = jsCode.replace(
            'projectId: "1"',
            `projectId: "${project.odkProjectId}"`
        );
        jsCode = jsCode.replace(
            'formId: "malnutrition_test_v1"',
            `formId: "${project.odkFormId}"`
        );
        
        // Add research objectives to summary
        if (project.researchObjectives) {
            const objectivesArray = project.researchObjectives
                .split('\n')
                .filter(obj => obj.trim())
                .map(obj => obj.trim());
            
            jsCode = jsCode.replace(
                'submissionIds: processedData.map(item => item.submissionId)',
                `submissionIds: processedData.map(item => item.submissionId),
  researchObjectives: ${JSON.stringify(objectivesArray)}`
            );
        }
        
        node.parameters.jsCode = jsCode;
    }

    // Update submissions preparation node
    updateSubmissionsPrep(node, project) {
        let jsCode = node.parameters.jsCode;
        
        // Update project details
        jsCode = jsCode.replace(
            "'Project ID': summary.projectId",
            `'Project ID': summary.projectId || "${project.odkProjectId}"`
        );
        jsCode = jsCode.replace(
            "'Form ID': summary.formId",
            `'Form ID': summary.formId || "${project.odkFormId}"`
        );
        
        // Add project title to records
        jsCode = jsCode.replace(
            "'Run ID': runId",
            `'Run ID': runId,
  'Project Title': "${project.title}"`
        );
        
        node.parameters.jsCode = jsCode;
    }

    // Update summary preparation node
    updateSummaryPrep(node, project) {
        let jsCode = node.parameters.jsCode;
        
        // Add project details to summary
        jsCode = jsCode.replace(
            "'Created At': formatDateForAirtable(new Date().toISOString())",
            `'Created At': formatDateForAirtable(new Date().toISOString()),
  'Project Title': "${project.title}",
  'Sync Interval': ${project.syncInterval}`
        );
        
        node.parameters.jsCode = jsCode;
    }

    // Update Airtable nodes with project base ID
    updateAirtableNodes(node, project) {
        if (project.airtableBase) {
            node.parameters.base.value = project.airtableBase;
            node.parameters.base.cachedResultUrl = `https://airtable.com/${project.airtableBase}`;
        }
        
        // Update table names to be project-specific
        if (node.name.includes('Individual Submissions')) {
            node.parameters.table = `${project.title} - Submissions`;
        } else if (node.name.includes('Summary')) {
            if (node.parameters.table && typeof node.parameters.table === 'object') {
                node.parameters.table.cachedResultName = `${project.title} - Summary Stats`;
            } else {
                node.parameters.table = `${project.title} - Summary Stats`;
            }
        }
    }

    // Get base workflow template
    getBaseTemplate() {
        return {
            "name": "TathminiAI - Template",
            "nodes": [
                {
                    "parameters": {
                        "rule": {
                            "interval": [
                                {
                                    "field": "minutes",
                                    "minutesInterval": 15
                                }
                            ]
                        }
                    },
                    "type": "n8n-nodes-base.scheduleTrigger",
                    "typeVersion": 1.2,
                    "position": [-560, 2240],
                    "id": "schedule-trigger",
                    "name": "Schedule Trigger"
                },
                {
                    "parameters": {
                        "method": "POST",
                        "url": "https://tathmini-mcp-servers-production.up.railway.app/odk-mcp/tools/fetch_submissions",
                        "sendHeaders": true,
                        "headerParameters": {
                            "parameters": [
                                {
                                    "name": "Content-Type",
                                    "value": "application/json"
                                }
                            ]
                        },
                        "sendBody": true,
                        "specifyBody": "json",
                        "jsonBody": "{\n  \"projectId\": \"1\",\n  \"formId\": \"malnutrition_test_v1\",\n  \"lastSync\": null\n}",
                        "options": {}
                    },
                    "type": "n8n-nodes-base.httpRequest",
                    "typeVersion": 4.2,
                    "position": [-300, 2240],
                    "id": "fetch-odk",
                    "name": "Fetch ODK Submissions"
                },
                {
                    "parameters": {
                        "jsCode": "// Process the HTTP response from ODK MCP Server\nconst response = $json;\n\n// Check if the request was successful\nif (!response.success) {\n  throw new Error(`ODK fetch failed: ${response.error}`);\n}\n\n// Extract submissions data\nconst submissions = response.data || [];\nconst count = response.count || 0;\nconst timestamp = response.timestamp;\n\nconsole.log(`Received ${count} submissions from ODK`);\n\n// Process each submission\nconst processedData = submissions.map((submission, index) => {\n  return {\n    // Basic submission info\n    submissionId: submission.instanceId,\n    submitterId: submission.submitterId,\n    deviceId: submission.deviceId,\n    createdAt: submission.createdAt,\n    updatedAt: submission.updatedAt,\n    reviewState: submission.reviewState,\n    userAgent: submission.userAgent,\n    \n    // Current version info\n    currentVersion: submission.currentVersion,\n    \n    // Processing metadata\n    processedAt: new Date().toISOString(),\n    processingIndex: index + 1,\n    totalSubmissions: count,\n    \n    // Data quality flags\n    dataQuality: {\n      hasInstanceId: !!submission.instanceId,\n      hasSubmitterId: !!submission.submitterId,\n      hasCreatedAt: !!submission.createdAt,\n      isComplete: submission.reviewState !== 'rejected',\n      qualityScore: calculateQualityScore(submission)\n    },\n    \n    // Original submission data\n    originalData: submission\n  };\n});\n\n// Calculate data quality score\nfunction calculateQualityScore(submission) {\n  let score = 0;\n  const maxScore = 5;\n  \n  if (submission.instanceId) score += 1;\n  if (submission.submitterId) score += 1;\n  if (submission.createdAt) score += 1;\n  if (submission.reviewState !== 'rejected') score += 1;\n  if (submission.currentVersion) score += 1;\n  \n  return (score / maxScore * 100).toFixed(1) + '%';\n}\n\n// Create summary statistics\nconst summary = {\n  totalSubmissions: count,\n  fetchedAt: timestamp,\n  processedAt: new Date().toISOString(),\n  projectId: \"1\",\n  formId: \"malnutrition_test_v1\",\n  mcpServerUrl: \"https://tathmini-mcp-servers-production.up.railway.app\",\n  dataQuality: {\n    averageQualityScore: processedData.length > 0 \n      ? (processedData.reduce((sum, item) => sum + parseFloat(item.dataQuality.qualityScore), 0) / processedData.length).toFixed(1) + '%'\n      : '0%',\n    completeSubmissions: processedData.filter(item => item.dataQuality.isComplete).length,\n    incompleteSubmissions: processedData.filter(item => !item.dataQuality.isComplete).length\n  },\n  submissionIds: processedData.map(item => item.submissionId)\n};\n\n// Return both summary and detailed data\nreturn [\n  {\n    json: {\n      type: 'processed_data',\n      summary: summary,\n      detailedData: processedData,\n      rawResponse: response\n    }\n  }\n];"
                    },
                    "id": "process-data",
                    "name": "Process Submissions Data",
                    "type": "n8n-nodes-base.code",
                    "typeVersion": 2,
                    "position": [-80, 2240]
                },
                {
                    "parameters": {
                        "jsCode": "// Prepare individual submission records for Airtable (FIXED DATE FORMAT)\nconst inputData = $json;\nconst summary = inputData.summary;\nconst detailedData = inputData.detailedData;\n\n// Generate unique run ID\nconst runId = `run_${Date.now()}`;\n\nconsole.log('Preparing individual submissions for Airtable:', detailedData.length, 'records');\n\n// Helper function to format dates for Airtable\nfunction formatDateForAirtable(dateString) {\n  if (!dateString) return null;\n  try {\n    const date = new Date(dateString);\n    if (isNaN(date.getTime())) return null;\n    return date.toISOString();\n  } catch (error) {\n    console.log('Date formatting error:', error);\n    return null;\n  }\n}\n\n// Create individual submission records\nconst submissionRecords = detailedData.map(submission => ({\n  'Project ID': summary.projectId,\n  'Form ID': summary.formId,\n  'Submission ID': submission.submissionId,\n  'Submitter ID': submission.submitterId?.toString() || 'Unknown',\n  'Created At': formatDateForAirtable(submission.createdAt),\n  'Quality Score': submission.dataQuality.qualityScore,\n  'Is Complete': submission.dataQuality.isComplete,\n  'Device ID': submission.deviceId || 'Unknown',\n  'User Agent': submission.userAgent ? submission.userAgent.substring(0, 255) : 'Unknown', // Limit length\n  'Fetched At': formatDateForAirtable(summary.fetchedAt),\n  'Processed At': formatDateForAirtable(submission.processedAt),\n  'Run ID': runId\n}));\n\nconsole.log('Sample record:', submissionRecords[0]);\n\n// Return each submission as a separate item\nreturn submissionRecords.map(record => ({ json: record }));"
                    },
                    "id": "prep-submissions",
                    "name": "Prepare Submissions for Airtable",
                    "type": "n8n-nodes-base.code",
                    "typeVersion": 2,
                    "position": [140, 2140]
                },
                {
                    "parameters": {
                        "jsCode": "// Prepare summary record for Airtable (FIXED DATE FORMAT)\nconst inputData = $json;\nconst summary = inputData.summary;\n\n// Generate unique run ID\nconst runId = `run_${Date.now()}`;\n\nconsole.log('Preparing summary record for Airtable');\n\n// Helper function to format dates for Airtable\nfunction formatDateForAirtable(dateString) {\n  if (!dateString) return null;\n  try {\n    const date = new Date(dateString);\n    if (isNaN(date.getTime())) return null;\n    return date.toISOString();\n  } catch (error) {\n    console.log('Date formatting error:', error);\n    return null;\n  }\n}\n\n// Create summary record\nconst summaryRecord = {\n  'Run ID': runId,\n  'Project ID': summary.projectId,\n  'Form ID': summary.formId,\n  'Total Submissions': summary.totalSubmissions,\n  'Complete Submissions': summary.dataQuality.completeSubmissions,\n  'Incomplete Submissions': summary.dataQuality.incompleteSubmissions,\n  'Average Quality Score': summary.dataQuality.averageQualityScore,\n  'Fetched At': formatDateForAirtable(summary.fetchedAt),\n  'MCP Server URL': summary.mcpServerUrl,\n  'Created At': formatDateForAirtable(new Date().toISOString())\n};\n\nconsole.log('Summary record:', summaryRecord);\n\n// Return the summary as a single item\nreturn [{ json: summaryRecord }];"
                    },
                    "id": "prep-summary",
                    "name": "Prepare Summary for Airtable",
                    "type": "n8n-nodes-base.code",
                    "typeVersion": 2,
                    "position": [140, 2340]
                },
                {
                    "parameters": {
                        "operation": "create",
                        "base": {
                            "__rl": true,
                            "value": "appXXXXXXXXXXXXXX",
                            "mode": "list",
                            "cachedResultName": "TathminiAI Data",
                            "cachedResultUrl": "https://airtable.com/appXXXXXXXXXXXXXX"
                        },
                        "table": "Submissions",
                        "columns": {
                            "mappingMode": "autoMapInputData",
                            "value": {},
                            "matchingColumns": [],
                            "schema": [],
                            "attemptToConvertTypes": true,
                            "convertFieldsToString": false
                        },
                        "options": {
                            "typecast": true
                        }
                    },
                    "id": "store-submissions",
                    "name": "Store in Airtable - Individual Submissions",
                    "type": "n8n-nodes-base.airtable",
                    "typeVersion": 2,
                    "position": [360, 2140],
                    "credentials": {
                        "airtableTokenApi": {
                            "id": "airtable-creds",
                            "name": "Airtable Personal Access Token account"
                        }
                    }
                },
                {
                    "parameters": {
                        "operation": "create",
                        "base": {
                            "__rl": true,
                            "value": "appXXXXXXXXXXXXXX",
                            "mode": "list",
                            "cachedResultName": "TathminiAI Data",
                            "cachedResultUrl": "https://airtable.com/appXXXXXXXXXXXXXX"
                        },
                        "table": {
                            "__rl": true,
                            "value": "tblXXXXXXXXXXXXXX",
                            "mode": "list",
                            "cachedResultName": "Summary Stats",
                            "cachedResultUrl": "https://airtable.com/appXXXXXXXXXXXXXX/tblXXXXXXXXXXXXXX"
                        },
                        "columns": {
                            "mappingMode": "autoMapInputData",
                            "value": {},
                            "matchingColumns": [],
                            "schema": [],
                            "attemptToConvertTypes": true,
                            "convertFieldsToString": false
                        },
                        "options": {
                            "typecast": true
                        }
                    },
                    "id": "store-summary",
                    "name": "Store in Airtable - Summary",
                    "type": "n8n-nodes-base.airtable",
                    "typeVersion": 2,
                    "position": [360, 2340],
                    "credentials": {
                        "airtableTokenApi": {
                            "id": "airtable-creds",
                            "name": "Airtable Personal Access Token account"
                        }
                    }
                }
            ],
            "connections": {
                "Schedule Trigger": {
                    "main": [
                        [
                            {
                                "node": "Fetch ODK Submissions",
                                "type": "main",
                                "index": 0
                            }
                        ]
                    ]
                },
                "Fetch ODK Submissions": {
                    "main": [
                        [
                            {
                                "node": "Process Submissions Data",
                                "type": "main",
                                "index": 0
                            }
                        ]
                    ]
                },
                "Process Submissions Data": {
                    "main": [
                        [
                            {
                                "node": "Prepare Submissions for Airtable",
                                "type": "main",
                                "index": 0
                            },
                            {
                                "node": "Prepare Summary for Airtable",
                                "type": "main",
                                "index": 0
                            }
                        ]
                    ]
                },
                "Prepare Submissions for Airtable": {
                    "main": [
                        [
                            {
                                "node": "Store in Airtable - Individual Submissions",
                                "type": "main",
                                "index": 0
                            }
                        ]
                    ]
                },
                "Prepare Summary for Airtable": {
                    "main": [
                        [
                            {
                                "node": "Store in Airtable - Summary",
                                "type": "main",
                                "index": 0
                            }
                        ]
                    ]
                }
            },
            "pinData": {},
            "meta": {
                "templateCredsSetupCompleted": true
            }
        };
    }

    // Generate multiple workflows for multiple projects
    generateAllWorkflows(projects) {
        return projects
            .filter(project => project.status === 'active')
            .map(project => ({
                project: project,
                workflow: this.generateWorkflow(project)
            }));
    }
}

module.exports = WorkflowGenerator;